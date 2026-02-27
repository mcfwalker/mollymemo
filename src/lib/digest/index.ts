// Voice Digest Orchestrator
// Coordinates script generation, TTS, and delivery

import { createServiceClient } from '@/lib/supabase'
import { generateScript, estimateDuration, updateUserContext, DigestItem, MemoItem, TrendItem } from './generator'
import { getContainerActivity, getCrossReferences, getProjectMatches } from './data-fetchers'
import { textToSpeech } from './tts'
import { sendVoiceMessage, sendTextMessage } from './sender'
import { EMPTY_DAY_SCRIPT } from './molly'
import logger from '@/lib/logger'

export interface DigestUser {
  id: string
  display_name: string | null
  telegram_user_id: number
  digest_frequency: string  // 'daily' | 'weekly' | 'never'
  digest_day: number        // 0=Sun, 1=Mon, ..., 6=Sat
  digest_time: string
  timezone: string
  molly_context: string | null
}

// Main orchestrator: generate and send a digest for a user
export async function generateAndSendDigest(
  user: DigestUser,
  frequency: 'daily' | 'weekly' = 'daily'
): Promise<void> {
  const supabase = createServiceClient()

  logger.info({ frequency, userId: user.id, displayName: user.display_name }, 'Generating digest')

  // Compute digest window
  const windowMs = frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const since = new Date(Date.now() - windowMs)

  // Fetch all data sources in parallel
  const [items, memos, trends, containerActivity, crossReferences, projectMatches] =
    await Promise.all([
      getItemsForDigest(user.id, since),
      getPendingMemos(user.id),
      getPendingTrends(user.id),
      getContainerActivity(user.id, since),
      getCrossReferences(user.id, since),
      getProjectMatches(user.id, since),
    ])

  if (items.length === 0) {
    // Send "nothing new" message
    logger.info({ userId: user.id }, 'No items for user, sending empty day message')
    const script = EMPTY_DAY_SCRIPT(user.display_name || 'there')
    const { audio: audioBuffer, cost: ttsCost } = await textToSpeech(script)
    const duration = estimateDuration(script)
    await sendVoiceMessage(user.telegram_user_id, audioBuffer, duration)
    // Store empty day digest with TTS cost only
    await supabase.from('digests').insert({
      user_id: user.id,
      script_text: script,
      item_ids: [],
      item_count: 0,
      anthropic_cost: null,
      tts_cost: ttsCost,
    })
    return
  }

  logger.info({ itemCount: items.length }, 'Found items for digest')

  // 2. Get previous digest for continuity
  const previousDigest = await getPreviousDigest(user.id)

  // 3. Generate script
  logger.info('Generating script with Claude')
  let anthropicCost = 0
  const { script, cost: scriptCost } = await generateScript({
    user: {
      id: user.id,
      displayName: user.display_name,
      timezone: user.timezone,
      mollyContext: user.molly_context,
    },
    frequency,
    items,
    memos,
    trends,
    containerActivity,
    crossReferences,
    projectMatches,
    previousDigest,
  })
  anthropicCost += scriptCost

  logger.info({ wordCount: script.split(/\s+/).length }, 'Script generated')

  // 4. Convert to audio
  logger.info('Converting to audio with OpenAI TTS')
  const { audio: audioBuffer, cost: ttsCost } = await textToSpeech(script)
  const duration = estimateDuration(script)

  logger.info({ bytes: audioBuffer.length, duration }, 'Audio generated')

  // 5. Send via Telegram
  logger.info('Sending voice message via Telegram')
  const result = await sendVoiceMessage(user.telegram_user_id, audioBuffer, duration)

  if (!result.success) {
    logger.error({ userId: user.id, error: result.error }, 'Failed to send digest')
    throw new Error(`Telegram delivery failed: ${result.error}`)
  }

  logger.info({ fileId: result.fileId }, 'Voice message sent')

  // 6. Store digest record
  const { data: insertedDigest, error: insertError } = await supabase
    .from('digests')
    .insert({
      user_id: user.id,
      script_text: script,
      telegram_file_id: result.fileId,
      item_ids: items.map((i) => i.id),
      item_count: items.length,
      previous_digest_id: previousDigest?.id || null,
      anthropic_cost: anthropicCost,
      tts_cost: ttsCost,
    })
    .select('id')
    .single()

  if (insertError) {
    logger.error({ err: insertError, userId: user.id }, 'Failed to store digest record')
  } else {
    logger.info({ userId: user.id }, 'Digest record stored')
  }

  // 7. Update Molly's context/memory about this user
  logger.info('Updating Molly context')
  try {
    const { context: newContext, cost: contextCost } = await updateUserContext(
      user.molly_context,
      items,
      user.display_name || 'this user'
    )
    anthropicCost += contextCost
    await supabase
      .from('users')
      .update({ molly_context: newContext })
      .eq('id', user.id)
    logger.info('Molly context updated')

    // Update digest with final anthropic cost (includes context update)
    if (insertedDigest?.id) {
      await supabase
        .from('digests')
        .update({ anthropic_cost: anthropicCost })
        .eq('id', insertedDigest.id)
    }
  } catch (e) {
    logger.error({ err: e }, 'Failed to update Molly context')
    // Non-fatal, continue
  }

  // 8. Mark memos as shown
  if (memos.length > 0) {
    await markMemosAsShown(memos.map(m => m.id))
    logger.info({ count: memos.length }, 'Marked memos as shown')
  }

  // 9. Mark trends as surfaced
  if (trends.length > 0) {
    await markTrendsAsSurfaced(trends.map(t => t.id))
    logger.info({ count: trends.length }, 'Marked trends as surfaced')
  }
}

// Get items captured within the digest window for a user
async function getItemsForDigest(userId: string, since: Date): Promise<DigestItem[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('items')
    .select('id, title, summary, domain, content_type, tags, source_url')
    .eq('user_id', userId)
    .eq('status', 'processed')
    .gte('processed_at', since.toISOString())
    .order('processed_at', { ascending: false })

  if (error) {
    logger.error({ err: error, userId }, 'Error fetching items for digest')
    return []
  }

  return (data || []).map((item) => ({
    id: item.id,
    title: item.title || 'Untitled',
    summary: item.summary || '',
    domain: item.domain,
    contentType: item.content_type,
    tags: item.tags,
    sourceUrl: item.source_url,
  }))
}

// Get the user's most recent digest
async function getPreviousDigest(userId: string): Promise<{
  id: string
  scriptText: string
  generatedAt: Date
  itemCount: number
} | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('digests')
    .select('id, script_text, generated_at, item_count')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return null
  }

  return {
    id: data.id,
    scriptText: data.script_text,
    generatedAt: new Date(data.generated_at),
    itemCount: data.item_count,
  }
}

// Get users whose digest time matches the current hour
export async function getUsersForDigestNow(): Promise<{ user: DigestUser; frequency: 'daily' | 'weekly' }[]> {
  const supabase = createServiceClient()

  const { data: users, error } = await supabase
    .from('users')
    .select('id, display_name, telegram_user_id, digest_frequency, digest_day, digest_time, timezone, molly_context')
    .in('digest_frequency', ['daily', 'weekly'])
    .not('telegram_user_id', 'is', null)

  if (error || !users) {
    logger.error({ err: error }, 'Error fetching users for digest')
    return []
  }

  const now = new Date()

  return users.filter((user) => {
    try {
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone || 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })

      const [hourStr, minuteStr] = userTimeStr.split(':')
      const userHour = parseInt(hourStr, 10)
      const userMinute = parseInt(minuteStr, 10)
      const [prefHour] = (user.digest_time || '07:00').split(':').map(Number)

      // Must match preferred hour and be within first 5 minutes
      if (userHour !== prefHour || userMinute >= 5) return false

      // For weekly, also check day of week
      if (user.digest_frequency === 'weekly') {
        const userDayStr = now.toLocaleString('en-US', {
          timeZone: user.timezone || 'America/Los_Angeles',
          weekday: 'short',
        })
        const dayMap: Record<string, number> = {
          'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
        }
        const userDay = dayMap[userDayStr] ?? -1
        if (userDay !== (user.digest_day ?? 1)) return false
      }

      return true
    } catch (e) {
      logger.error({ err: e, userId: user.id }, 'Error checking time for user')
      return false
    }
  }).map(user => ({
    user: user as unknown as DigestUser,
    frequency: user.digest_frequency as 'daily' | 'weekly',
  }))
}

// Get pending memos (Molly's discoveries) for a user
async function getPendingMemos(userId: string): Promise<MemoItem[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('memos')
    .select('id, title, summary, relevance_reason, source_platform, source_url')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('relevance_score', { ascending: false })
    .limit(5) // Max 5 memos per digest

  if (error) {
    logger.error({ err: error, userId }, 'Error fetching pending memos')
    return []
  }

  return (data || []).map((memo) => ({
    id: memo.id,
    title: memo.title || 'Untitled',
    summary: memo.summary || '',
    relevanceReason: memo.relevance_reason || '',
    sourcePlatform: memo.source_platform,
    sourceUrl: memo.source_url,
  }))
}

// Get pending trends for a user
async function getPendingTrends(userId: string): Promise<TrendItem[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('trends')
    .select('id, trend_type, title, description, strength')
    .eq('user_id', userId)
    .eq('surfaced', false)
    .gt('expires_at', new Date().toISOString())
    .order('strength', { ascending: false })
    .limit(3)

  if (error) {
    logger.error({ err: error, userId }, 'Error fetching pending trends')
    return []
  }

  return (data || []).map((t) => ({
    id: t.id,
    trendType: t.trend_type,
    title: t.title,
    description: t.description,
    strength: t.strength,
  }))
}

// Mark memos as shown after including in digest
async function markMemosAsShown(memoIds: string[]): Promise<void> {
  const supabase = createServiceClient()

  await supabase
    .from('memos')
    .update({
      status: 'shown',
      shown_at: new Date().toISOString(),
    })
    .in('id', memoIds)
}

// Mark trends as surfaced after including in digest
async function markTrendsAsSurfaced(trendIds: string[]): Promise<void> {
  const supabase = createServiceClient()

  await supabase
    .from('trends')
    .update({ surfaced: true })
    .in('id', trendIds)
}
