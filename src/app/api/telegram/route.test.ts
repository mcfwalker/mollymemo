import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

// Capture callbacks passed to after()
let afterCallbacks: Array<() => Promise<void>> = []

// Mock dependencies
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void>) => {
      afterCallbacks.push(callback)
    }),
  }
})

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  getUserByTelegramId: vi.fn(),
  extractUrl: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import { sendMessage, getUserByTelegramId, extractUrl } from '@/lib/telegram'

const TEST_USER = {
  id: 'test-user-uuid',
  email: 'test@example.com',
  display_name: 'Test',
  digest_frequency: 'daily',
  digest_day: 1,
  digest_time: '07:00',
  timezone: 'America/Los_Angeles',
  telegram_user_id: 123456,
  telegram_welcome_sent: true,
  molly_context: null,
}
const TEST_WEBHOOK_SECRET = 'test-webhook-secret-123'

// Helper to create mock telegram update
function createTelegramUpdate(
  userId: number,
  chatId: number,
  text?: string,
  caption?: string
): NextRequest {
  const message: Record<string, unknown> = { from: { id: userId }, chat: { id: chatId } }
  if (text) message.text = text
  if (caption) message.caption = caption

  return new NextRequest('http://localhost/api/telegram', {
    method: 'POST',
    headers: {
      'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET,
    },
    body: JSON.stringify({ message }),
  })
}

describe('telegram webhook route', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    gte: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    afterCallbacks = []
    process.env.TELEGRAM_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }

    mockSupabase.from.mockReturnValue(mockSupabase)
    mockSupabase.select.mockReturnValue(mockSupabase)
    mockSupabase.insert.mockReturnValue(mockSupabase)
    mockSupabase.eq.mockReturnValue(mockSupabase)
    mockSupabase.gte.mockReturnValue(mockSupabase)
    mockSupabase.limit.mockReturnValue({ data: null })
    mockSupabase.single.mockReturnValue({
      data: { id: 'new-item-id' },
      error: null,
    })

    vi.mocked(createServiceClient).mockReturnValue(
      mockSupabase as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(getUserByTelegramId).mockResolvedValue(TEST_USER)
    vi.mocked(extractUrl).mockReturnValue('https://example.com')
    vi.mocked(sendMessage).mockResolvedValue(true)

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  describe('webhook security', () => {
    it('rejects requests without valid secret token', async () => {
      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        headers: {
          'x-telegram-bot-api-secret-token': 'wrong-secret',
        },
        body: JSON.stringify({ message: { from: { id: 123 }, chat: { id: 123 }, text: 'test' } }),
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it('rejects requests with missing secret token', async () => {
      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        body: JSON.stringify({ message: { from: { id: 123 }, chat: { id: 123 }, text: 'test' } }),
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it('rejects requests when no secret is configured (fail-closed)', async () => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET

      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        body: JSON.stringify({ message: { from: { id: 123 }, chat: { id: 123 }, text: 'no url here' } }),
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })
  })

  describe('message filtering', () => {
    it('ignores updates without text or caption', async () => {
      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
        body: JSON.stringify({ message: { from: { id: 123 }, chat: { id: 123 } } }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('ignores updates without message at all', async () => {
      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 123 }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('processes messages with caption (media shares like TikTok)', async () => {
      vi.mocked(getUserByTelegramId).mockResolvedValue(TEST_USER)
      vi.mocked(extractUrl).mockReturnValue('https://vm.tiktok.com/abc123')

      const request = createTelegramUpdate(123, 123, undefined, 'Check this out https://vm.tiktok.com/abc123')
      await POST(request)

      expect(extractUrl).toHaveBeenCalledWith('Check this out https://vm.tiktok.com/abc123')
      expect(sendMessage).toHaveBeenCalled()
    })

    it('prefers text over caption when both are present', async () => {
      vi.mocked(getUserByTelegramId).mockResolvedValue(TEST_USER)
      vi.mocked(extractUrl).mockReturnValue('https://example.com')

      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
        body: JSON.stringify({
          message: {
            from: { id: 123 },
            chat: { id: 123 },
            text: 'text content https://example.com',
            caption: 'caption content https://other.com',
          },
        }),
      })
      await POST(request)

      expect(extractUrl).toHaveBeenCalledWith('text content https://example.com')
    })
  })

  describe('user authorization', () => {
    it('silently ignores unauthorized users', async () => {
      vi.mocked(getUserByTelegramId).mockResolvedValue(null)

      const request = createTelegramUpdate(999999, 999999, 'https://example.com')
      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('processes messages from allowed users', async () => {
      vi.mocked(getUserByTelegramId).mockResolvedValue(TEST_USER)

      const request = createTelegramUpdate(123456, 123456, 'https://example.com')
      await POST(request)

      expect(sendMessage).toHaveBeenCalled()
    })
  })

  describe('URL extraction', () => {
    it('responds with help when no URL in message', async () => {
      vi.mocked(extractUrl).mockReturnValue(null)

      const request = createTelegramUpdate(123, 123, 'Just some text')
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        'Send me a link to capture, or tell me when you want your daily digest!'
      )
    })

    it('responds with error for invalid URL', async () => {
      vi.mocked(extractUrl).mockReturnValue('not-a-valid-url')

      const request = createTelegramUpdate(123, 123, 'Check this not-a-valid-url')
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        "That doesn't look like a valid URL"
      )
    })

    it('responds with error for malformed hostname', async () => {
      vi.mocked(extractUrl).mockReturnValue('https://null/path')

      const request = createTelegramUpdate(123, 123, 'Check https://null/path')
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        "That doesn't look like a valid URL"
      )
    })
  })

  describe('duplicate detection', () => {
    it('responds when URL was captured recently', async () => {
      mockSupabase.limit.mockReturnValue({ data: [{ id: 'existing-id' }] })

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(123, 'Already captured this recently')
    })
  })

  describe('successful capture', () => {
    beforeEach(() => {
      mockSupabase.limit.mockReturnValue({ data: [] })
    })

    it('sends acknowledgment immediately', async () => {
      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(123, 'Got it! Processing...')
    })

    it('inserts item to database with user_id', async () => {
      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(mockSupabase.insert).toHaveBeenCalledWith({
        source_url: 'https://example.com/',
        source_type: 'article',
        status: 'pending',
        user_id: TEST_USER.id,
      })
    })

    it('sends item/captured event to Inngest', async () => {
      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(inngest.send).toHaveBeenCalledWith({
        name: 'item/captured',
        data: {
          itemId: 'new-item-id',
          sourceType: 'article',
          sourceUrl: 'https://example.com/',
          userId: TEST_USER.id,
          chatId: 123,
        },
      })
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.limit.mockReturnValue({ data: [] })
    })

    it('sends error message on database insert failure', async () => {
      mockSupabase.single.mockReturnValue({
        data: null,
        error: { message: 'DB error' },
      })

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        'Failed to capture - check the web app'
      )
    })

    it('always returns ok:true to Telegram', async () => {
      mockSupabase.single.mockReturnValue({
        data: null,
        error: { message: 'DB error' },
      })

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
    })
  })
})
