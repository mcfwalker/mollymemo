import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { detectSourceType } from '@/lib/processors/detect'
import { processItem } from '@/lib/processors'
import { sendMessage, isAllowedUser, extractUrl } from '@/lib/telegram'

interface TelegramUpdate {
  message?: {
    message_id: number
    from: { id: number }
    chat: { id: number }
    text?: string
  }
}

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json()

    // Only handle text messages
    if (!update.message?.text) {
      return NextResponse.json({ ok: true })
    }

    const { from, chat, text } = update.message
    const userId = from.id
    const chatId = chat.id

    // Check user whitelist - silent ignore for unknown users
    if (!isAllowedUser(userId)) {
      return NextResponse.json({ ok: true })
    }

    // Extract URL from message
    const url = extractUrl(text)
    if (!url) {
      await sendMessage(chatId, 'Send me a link to capture')
      return NextResponse.json({ ok: true })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      await sendMessage(chatId, "That doesn't look like a valid URL")
      return NextResponse.json({ ok: true })
    }

    // Reject malformed hostnames
    const hostname = parsedUrl.hostname.toLowerCase()
    if (
      !hostname ||
      hostname === 'null' ||
      hostname === '(null)' ||
      hostname === 'undefined' ||
      !hostname.includes('.')
    ) {
      await sendMessage(chatId, "That doesn't look like a valid URL")
      return NextResponse.json({ ok: true })
    }

    const supabase = createServerClient()

    // Check for recent duplicate (same URL in last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('items')
      .select('id')
      .eq('source_url', parsedUrl.href)
      .gte('captured_at', oneDayAgo)
      .limit(1)

    if (existing && existing.length > 0) {
      await sendMessage(chatId, 'Already captured this recently')
      return NextResponse.json({ ok: true })
    }

    // Detect source type and insert
    const sourceType = detectSourceType(parsedUrl.href)

    const { data: item, error } = await supabase
      .from('items')
      .insert({
        source_url: parsedUrl.href,
        source_type: sourceType,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error || !item) {
      console.error('Insert error:', error)
      await sendMessage(chatId, 'Failed to capture - check the web app')
      return NextResponse.json({ ok: true })
    }

    // Send immediate acknowledgment
    await sendMessage(chatId, 'Got it! Processing...')

    // Process and send follow-up after response
    after(async () => {
      try {
        await processItem(item.id)

        // Fetch processed item for follow-up
        const { data: processed } = await supabase
          .from('items')
          .select('title, summary, status')
          .eq('id', item.id)
          .single()

        if (processed?.status === 'processed') {
          const title = processed.title || 'Untitled'
          const summary = processed.summary
            ? `\n${processed.summary.slice(0, 200)}${processed.summary.length > 200 ? '...' : ''}`
            : ''
          await sendMessage(chatId, `✓ ${title}${summary}`)
        } else {
          await sendMessage(chatId, 'Failed to process - check the web app')
        }
      } catch (err) {
        console.error('Background processing error:', err)
        await sendMessage(chatId, 'Failed to process - check the web app')
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
