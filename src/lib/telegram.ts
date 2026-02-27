import { createServiceClient } from '@/lib/supabase'
import logger from '@/lib/logger'

const TELEGRAM_API = 'https://api.telegram.org/bot'

export interface TelegramUser {
  id: string
  email: string
  display_name: string | null
  digest_frequency: string
  digest_day: number
  digest_time: string
  timezone: string
  telegram_user_id: number
  telegram_welcome_sent: boolean
  molly_context: string | null
}

export async function getUserByTelegramId(
  telegramUserId: number
): Promise<TelegramUser | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, email, display_name, digest_frequency, digest_day, digest_time, timezone, telegram_user_id, telegram_welcome_sent, molly_context'
    )
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (error || !data) {
    return null
  }

  return {
    ...data,
    digest_frequency: data.digest_frequency ?? 'daily',
    digest_day: data.digest_day ?? 1,
    digest_time: data.digest_time ?? '07:00',
    timezone: data.timezone ?? 'America/Los_Angeles',
    telegram_welcome_sent: data.telegram_welcome_sent ?? false,
  }
}

export async function sendMessage(
  chatId: number,
  text: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN not configured')
    return false
  }

  try {
    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      logger.error({ status: response.status, body }, 'Telegram API error')
      return false
    }

    return true
  } catch (error) {
    logger.error({ err: error, chatId }, 'Failed to send Telegram message')
    return false
  }
}

export function extractUrl(text: string): string | null {
  // Match URLs in the message text
  const urlPattern = /https?:\/\/[^\s]+/i
  const match = text.match(urlPattern)
  return match ? match[0] : null
}
