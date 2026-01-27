import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isAllowedUser, extractUrl, sendMessage } from './telegram'

describe('telegram helpers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('isAllowedUser', () => {
    it('returns false when TELEGRAM_ALLOWED_USERS is not set', () => {
      delete process.env.TELEGRAM_ALLOWED_USERS
      expect(isAllowedUser(123456789)).toBe(false)
    })

    it('returns false when user is not in list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '111111,222222'
      expect(isAllowedUser(333333)).toBe(false)
    })

    it('returns true when user is in list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '111111,222222,333333'
      expect(isAllowedUser(222222)).toBe(true)
    })

    it('handles whitespace in user list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '111111, 222222 , 333333'
      expect(isAllowedUser(222222)).toBe(true)
    })

    it('handles single user in list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123456789'
      expect(isAllowedUser(123456789)).toBe(true)
    })
  })

  describe('extractUrl', () => {
    it('extracts https URL from text', () => {
      expect(extractUrl('Check this out https://example.com/page')).toBe(
        'https://example.com/page'
      )
    })

    it('extracts http URL from text', () => {
      expect(extractUrl('Look at http://example.com')).toBe('http://example.com')
    })

    it('returns null when no URL present', () => {
      expect(extractUrl('Just some text')).toBeNull()
    })

    it('extracts first URL when multiple present', () => {
      expect(
        extractUrl('First https://first.com then https://second.com')
      ).toBe('https://first.com')
    })

    it('handles URL at start of message', () => {
      expect(extractUrl('https://example.com is cool')).toBe(
        'https://example.com'
      )
    })

    it('handles URL at end of message', () => {
      expect(extractUrl('Check this: https://example.com')).toBe(
        'https://example.com'
      )
    })

    it('extracts complex URLs with paths and query strings', () => {
      expect(
        extractUrl('Link: https://example.com/path?query=value&foo=bar')
      ).toBe('https://example.com/path?query=value&foo=bar')
    })
  })

  describe('sendMessage', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token'
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('returns false when token is not configured', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      const result = await sendMessage(123, 'Hello')
      expect(result).toBe(false)
    })

    it('sends message to Telegram API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      await sendMessage(123456, 'Test message')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/sendMessage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: 123456,
            text: 'Test message',
            disable_web_page_preview: true,
          }),
        }
      )
    })

    it('returns true on successful send', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      const result = await sendMessage(123, 'Hello')
      expect(result).toBe(true)
    })

    it('returns false on API error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Error'),
      })

      const result = await sendMessage(123, 'Hello')
      expect(result).toBe(false)
    })

    it('returns false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const result = await sendMessage(123, 'Hello')
      expect(result).toBe(false)
    })
  })
})
