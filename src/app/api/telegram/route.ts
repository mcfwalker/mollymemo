/**
 * Telegram Bot Webhook API Route
 *
 * Primary content capture endpoint. Receives messages from Telegram bot,
 * extracts URLs, and queues them for AI processing.
 *
 * POST /api/telegram - Webhook handler for Telegram bot updates
 *
 * Features:
 * - Validates webhook secret for security
 * - Extracts URLs from message text or captions
 * - Supports digest commands ("digest at 7am", "pause digest", etc.)
 * - Creates user records for new Telegram users
 * - Queues items for async processing (classification, transcription)
 *
 * Note: This route is public (no auth middleware) but protected by
 * Telegram's webhook secret verification.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { detectSourceType } from '@/lib/processors/detect'
import { inngest } from '@/inngest/client'
import {
  sendMessage,
  getUserByTelegramId,
  extractUrl,
  TelegramUser,
} from '@/lib/telegram'
import {
  parseDigestCommand,
  formatTimeForUser,
  DigestCommand,
} from '@/lib/digest-commands'
import { generateAndSendDigest, DigestUser } from '@/lib/digest'

interface TelegramUpdate {
  message?: {
    message_id: number
    from: { id: number }
    chat: { id: number }
    text?: string
    caption?: string // For media messages (videos, photos) with captions
  }
}

// Handle digest settings commands
// Returns 'send_now' if digest should be generated in background
async function handleDigestCommand(
  chatId: number,
  user: TelegramUser,
  command: DigestCommand
): Promise<string | void> {
  const supabase = createServiceClient()

  switch (command.action) {
    case 'set_time':
      if (command.time) {
        await supabase
          .from('users')
          .update({ digest_time: command.time, digest_frequency: 'daily' })
          .eq('id', user.id)

        const friendly = formatTimeForUser(command.time, user.timezone)
        await sendMessage(chatId, `Got it! I'll send your digest at ${friendly}.`)
      }
      break

    case 'enable': {
      await supabase
        .from('users')
        .update({ digest_frequency: 'daily' })
        .eq('id', user.id)

      const enableTime = formatTimeForUser(
        user.digest_time || '07:00',
        user.timezone
      )
      await sendMessage(chatId, `Digest enabled! You'll get it at ${enableTime}.`)
      break
    }

    case 'disable':
      await supabase
        .from('users')
        .update({ digest_frequency: 'never' })
        .eq('id', user.id)

      await sendMessage(
        chatId,
        'Digest paused. Just say "turn it on" when you want it back.'
      )
      break

    case 'query':
      if (user.digest_frequency !== 'never') {
        const queryTime = formatTimeForUser(
          user.digest_time || '07:00',
          user.timezone
        )
        await sendMessage(chatId, `Your digest is set for ${queryTime}.`)
      } else {
        await sendMessage(
          chatId,
          'Your digest is currently paused. Say "turn it on" to enable.'
        )
      }
      break

    case 'send_now':
      // Return 'send_now' to signal main handler to use after()
      await sendMessage(chatId, 'Generating your digest now...')
      return 'send_now'
  }
}

// Verify Telegram webhook secret token
// https://core.telegram.org/bots/api#setwebhook
function verifyTelegramSecret(request: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) {
    console.error('TELEGRAM_WEBHOOK_SECRET not configured — rejecting request')
    return false
  }

  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token')
  return headerSecret === secret
}

export async function POST(request: NextRequest) {
  // Verify webhook secret before processing
  if (!verifyTelegramSecret(request)) {
    // Return 401 but don't reveal details
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    const update: TelegramUpdate = await request.json()

    // Handle text messages or media with captions (e.g., TikTok shares)
    const message = update.message
    if (!message) {
      return NextResponse.json({ ok: true })
    }

    const messageText = message.text || message.caption
    if (!messageText) {
      return NextResponse.json({ ok: true })
    }

    const { from, chat } = message
    const telegramUserId = from.id
    const chatId = chat.id

    // Look up user by Telegram ID - silent ignore for unknown users
    const user = await getUserByTelegramId(telegramUserId)
    if (!user) {
      return NextResponse.json({ ok: true })
    }

    const supabase = createServiceClient()

    // Send welcome message on first interaction
    if (!user.telegram_welcome_sent) {
      const time = formatTimeForUser(
        user.digest_time || '07:00',
        user.timezone || 'America/Los_Angeles'
      )
      await sendMessage(
        chatId,
        `Hey ${user.display_name || 'there'}! I'll send your daily digest at ${time}. Just reply with a new time if you want to change it.`
      )

      // Mark welcome as sent
      await supabase
        .from('users')
        .update({ telegram_welcome_sent: true })
        .eq('id', user.id)
    }

    // Extract URL from message
    const url = extractUrl(messageText)
    if (!url) {
      // Try parsing as digest command
      const command = await parseDigestCommand(messageText)

      if (command.action !== 'unknown') {
        const result = await handleDigestCommand(chatId, user, command)

        // If send_now, generate digest in background after response
        if (result === 'send_now') {
          after(async () => {
            try {
              await generateAndSendDigest({
                id: user.id,
                display_name: user.display_name,
                telegram_user_id: user.telegram_user_id,
                digest_frequency: user.digest_frequency || 'daily',
                digest_day: user.digest_day ?? 1,
                digest_time: user.digest_time || '07:00',
                timezone: user.timezone || 'America/Los_Angeles',
                molly_context: user.molly_context,
              } as DigestUser)
            } catch (error) {
              console.error('Failed to generate digest:', error)
              await sendMessage(chatId, 'Failed to generate digest. Try again later.')
            }
          })
        }

        return NextResponse.json({ ok: true })
      }

      // Not a URL or command
      await sendMessage(
        chatId,
        'Send me a link to capture, or tell me when you want your daily digest!'
      )
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

    // Check for recent duplicate (same URL in last 24h for this user)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('items')
      .select('id')
      .eq('source_url', parsedUrl.href)
      .eq('user_id', user.id)
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
        user_id: user.id,
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

    // Send event to Inngest for processing
    await inngest.send({
      name: 'item/captured',
      data: {
        itemId: item.id,
        sourceType: sourceType,
        sourceUrl: parsedUrl.href,
        userId: user.id,
        chatId: chatId,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
