const TELEGRAM_API = 'https://api.telegram.org/bot'

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
