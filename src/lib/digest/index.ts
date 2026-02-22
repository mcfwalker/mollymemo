// Voice Digest Orchestrator
// Coordinates script generation, TTS, and delivery

import { createServiceClient } from '@/lib/supabase'
import { generateScript, estimateDuration, updateUserContext, DigestItem, MemoItem, TrendItem } from './generator'
import { textToSpeech } from './tts'
import { sendVoiceMessage, sendTextMessage } from './sender'
import { EMPTY_DAY_SCRIPT } from './molly'

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
export async function generateAndSendDigest(user: DigestUser): Promise<void> {
  const supabase = createServiceClient()

  console.log(`Generating digest for user ${user.id} (${user.display_name})`)

  // 1. Get items from last 24 hours
  const items = await getItemsForDigest(user.id)

  // 1b. Get pending memos (Molly's discoveries)
  const memos = await getPendingMemos(user.id)

  // 1c. Get pending trends
  const trends = await getPendingTrends(user.id)

  if (items.length === 0) {
    // Send "nothing new" message
    console.log(`No items for user ${user.id}, sending empty day message`)
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

  console.log(`Found ${items.length} items for digest`)

  // 2. Get previous digest for continuity
  const previousDigest = await getPreviousDigest(user.id)

  // 3. Generate script
  console.log('Generating script with Claude...')
  let anthropicCost = 0
  const { script, cost: scriptCost } = await generateScript({
    user: {
      id: user.id,
      displayName: user.display_name,
      timezone: user.timezone,
      mollyContext: user.molly_context,
    },
    items,
    memos,
    trends,
    previousDigest,
  })
  anthropicCost += scriptCost

  console.log(`Script generated: ${script.split(/\s+/).length} words`)

  // 4. Convert to audio
  console.log('Converting to audio with OpenAI TTS...')
  const { audio: audioBuffer, cost: ttsCost } = await textToSpeech(script)
  const duration = estimateDuration(script)

  console.log(`Audio generated: ${audioBuffer.length} bytes, ~${duration}s`)

  // 5. Send via Telegram
  console.log('Sending voice message via Telegram...')
  const result = await sendVoiceMessage(user.telegram_user_id, audioBuffer, duration)

  if (!result.success) {
    console.error(`Failed to send digest to user ${user.id}:`, result.error)
    throw new Error(`Telegram delivery failed: ${result.error}`)
  }

  console.log(`Voice message sent, file_id: ${result.fileId}`)

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
    console.error('Failed to store digest record:', insertError)
  } else {
    console.log(`Digest record stored for user ${user.id}`)
  }

  // 7. Update Molly's context/memory about this user
  console.log('Updating Molly context...')
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
    console.log('Molly context updated')

    // Update digest with final anthropic cost (includes context update)
    if (insertedDigest?.id) {
      await supabase
        .from('digests')
        .update({ anthropic_cost: anthropicCost })
        .eq('id', insertedDigest.id)
    }
  } catch (e) {
    console.error('Failed to update Molly context:', e)
    // Non-fatal, continue
  }

  // 8. Mark memos as shown
  if (memos.length > 0) {
    await markMemosAsShown(memos.map(m => m.id))
    console.log(`Marked ${memos.length} memos as shown`)
  }

  // 9. Mark trends as surfaced
  if (trends.length > 0) {
    await markTrendsAsSurfaced(trends.map(t => t.id))
    console.log(`Marked ${trends.length} trends as surfaced`)
  }
}

// Get items captured in the last 24 hours for a user
async function getItemsForDigest(userId: string): Promise<DigestItem[]> {
  const supabase = createServiceClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('items')
    .select('id, title, summary, domain, content_type, tags, source_url')
    .eq('user_id', userId)
    .eq('status', 'processed')
    .gte('processed_at', oneDayAgo)
    .order('processed_at', { ascending: false })

  if (error) {
    console.error('Error fetching items for digest:', error)
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
export async function getUsersForDigestNow(): Promise<DigestUser[]> {
  const supabase = createServiceClient()

  // Get all users with digest enabled
  const { data: users, error } = await supabase
    .from('users')
    .select('id, display_name, telegram_user_id, digest_enabled, digest_time, timezone, molly_context')
    .eq('digest_enabled', true)
    .not('telegram_user_id', 'is', null)

  if (error || !users) {
    console.error('Error fetching users for digest:', error)
    return []
  }

  const now = new Date()

  return users.filter((user) => {
    try {
      // Convert current UTC time to user's timezone
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone || 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })

      const [hourStr, minuteStr] = userTimeStr.split(':')
      const userHour = parseInt(hourStr, 10)
      const userMinute = parseInt(minuteStr, 10)

      // Parse user's preferred time
      const [prefHour] = (user.digest_time || '07:00').split(':').map(Number)

      // Match if we're in the right hour and within first 5 minutes
      return userHour === prefHour && userMinute < 5
    } catch (e) {
      console.error(`Error checking time for user ${user.id}:`, e)
      return false
    }
  }) as DigestUser[]
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
    console.error('Error fetching pending memos:', error)
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
    console.error('Error fetching pending trends:', error)
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
