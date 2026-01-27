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
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/processors', () => ({
  processItem: vi.fn(),
}))

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  isAllowedUser: vi.fn(),
  extractUrl: vi.fn(),
}))

import { createServerClient } from '@/lib/supabase'
import { processItem } from '@/lib/processors'
import { sendMessage, isAllowedUser, extractUrl } from '@/lib/telegram'

// Helper to create mock telegram update
function createTelegramUpdate(
  userId: number,
  chatId: number,
  text?: string
): NextRequest {
  const update = text
    ? { message: { from: { id: userId }, chat: { id: chatId }, text } }
    : { message: { from: { id: userId }, chat: { id: chatId } } }

  return new NextRequest('http://localhost/api/telegram', {
    method: 'POST',
    body: JSON.stringify(update),
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

    vi.mocked(createServerClient).mockReturnValue(
      mockSupabase as unknown as ReturnType<typeof createServerClient>
    )
    vi.mocked(processItem).mockResolvedValue(undefined)
    vi.mocked(isAllowedUser).mockReturnValue(true)
    vi.mocked(extractUrl).mockReturnValue('https://example.com')
    vi.mocked(sendMessage).mockResolvedValue(true)

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('message filtering', () => {
    it('ignores updates without text message', async () => {
      const request = new NextRequest('http://localhost/api/telegram', {
        method: 'POST',
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
        body: JSON.stringify({ update_id: 123 }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
      expect(sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('user authorization', () => {
    it('silently ignores unauthorized users', async () => {
      vi.mocked(isAllowedUser).mockReturnValue(false)

      const request = createTelegramUpdate(999999, 999999, 'https://example.com')
      const response = await POST(request)
      const data = await response.json()

      expect(data).toEqual({ ok: true })
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('processes messages from allowed users', async () => {
      vi.mocked(isAllowedUser).mockReturnValue(true)

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

      expect(sendMessage).toHaveBeenCalledWith(123, 'Send me a link to capture')
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

    it('inserts item to database', async () => {
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
      })
    })

    it('schedules background processing via after()', async () => {
      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      expect(afterCallbacks).toHaveLength(1)
    })

    it('sends follow-up with title and summary after processing', async () => {
      mockSupabase.single
        .mockReturnValueOnce({ data: { id: 'new-item-id' }, error: null })
        .mockReturnValueOnce({
          data: {
            title: 'Example Article',
            summary: 'This is a summary',
            status: 'ready',
          },
          error: null,
        })

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      // Execute the after() callback
      await afterCallbacks[0]()

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        '✓ Example Article\nThis is a summary'
      )
    })

    it('truncates long summaries in follow-up', async () => {
      const longSummary = 'x'.repeat(300)
      // Clear sendMessage mock calls from previous tests
      vi.mocked(sendMessage).mockClear()

      // Reset and set up fresh mock chain
      mockSupabase.single = vi.fn()
        .mockReturnValueOnce({ data: { id: 'new-item-id' }, error: null })
        .mockReturnValueOnce({
          data: {
            title: 'Title',
            summary: longSummary,
            status: 'ready',
          },
          error: null,
        })
      mockSupabase.insert.mockReturnValue(mockSupabase)
      mockSupabase.select.mockReturnValue(mockSupabase)

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)
      await afterCallbacks[0]()

      // Find the success message (starts with ✓)
      const calls = vi.mocked(sendMessage).mock.calls
      const successCall = calls.find((c) => c[1].startsWith('✓'))
      expect(successCall).toBeDefined()
      expect(successCall?.[1]).toContain('...')
      expect(successCall?.[1].length).toBeLessThan(250)
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

    it('sends error message when processing fails', async () => {
      vi.mocked(processItem).mockRejectedValue(new Error('Processing failed'))

      const request = createTelegramUpdate(
        123,
        123,
        'Check https://example.com'
      )
      await POST(request)

      // Execute the after() callback
      await afterCallbacks[0]()

      expect(sendMessage).toHaveBeenCalledWith(
        123,
        'Failed to process - check the web app'
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
