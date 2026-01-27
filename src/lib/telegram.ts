import { createServerClient } from '@/lib/supabase'

const TELEGRAM_API = 'https://api.telegram.org/bot'

export interface TelegramUser {
  id: string
  email: string
  display_name: string | null
}

export async function getUserByTelegramId(telegramUserId: number): Promise<TelegramUser | null> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name')
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (error || !data) {
    return null
  }

  return data
}

export async function sendMessage(
  chatId: number,
  text: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
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
      console.error('Telegram API error:', await response.text())
      return false
    }

    return true
  } catch (error) {
    console.error('Failed to send Telegram message:', error)
    return false
  }
}

// Legacy function - kept for backward compatibility during migration
// TODO: Remove after multi-user migration complete
export function isAllowedUser(userId: number): boolean {
  const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS || ''
  const userIds = allowedUsers.split(',').map((id) => id.trim())
  return userIds.includes(String(userId))
}

export function extractUrl(text: string): string | null {
  // Match URLs in the message text
  const urlPattern = /https?:\/\/[^\s]+/i
  const match = text.match(urlPattern)
  return match ? match[0] : null
}
