import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  secureCompare,
  checkRateLimit,
  generateSessionToken,
  verifySessionToken,
  getUserIdFromToken,
  hashPassword,
  verifyPassword,
  sanitizeSearchInput,
} from './security'

describe('secureCompare', () => {
  it('returns true for identical strings', () => {
    expect(secureCompare('test', 'test')).toBe(true)
    expect(secureCompare('longer string here', 'longer string here')).toBe(true)
  })

  it('returns false for different strings', () => {
    expect(secureCompare('test', 'test2')).toBe(false)
    expect(secureCompare('abc', 'xyz')).toBe(false)
  })

  it('returns false for different length strings', () => {
    expect(secureCompare('short', 'much longer string')).toBe(false)
  })

  it('returns false for empty or null-ish inputs', () => {
    expect(secureCompare('', 'test')).toBe(false)
    expect(secureCompare('test', '')).toBe(false)
    expect(secureCompare('', '')).toBe(false)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows first request', () => {
    const result = checkRateLimit('test-key-1', 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('tracks multiple requests within window', () => {
    const key = 'test-key-2'
    checkRateLimit(key, 5, 60000)
    checkRateLimit(key, 5, 60000)
    const result = checkRateLimit(key, 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('blocks requests after limit reached', () => {
    const key = 'test-key-3'
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60000)
    }
    const result = checkRateLimit(key, 5, 60000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after window expires', () => {
    const key = 'test-key-4'
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60000)
    }

    // Advance time past the window
    vi.advanceTimersByTime(61000)

    const result = checkRateLimit(key, 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })
})

describe('generateSessionToken and verifySessionToken', () => {
  const originalEnv = process.env
  const testUserId = 'test-user-id-123'

  beforeEach(() => {
    process.env = { ...originalEnv, SITE_PASSWORD_HASH: 'test-secret-key-12345' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('generates a valid token format', () => {
    const token = generateSessionToken(testUserId)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('generates verifiable tokens', () => {
    const token = generateSessionToken(testUserId)
    expect(verifySessionToken(token)).toBe(true)
  })

  it('rejects tampered tokens', () => {
    const token = generateSessionToken(testUserId)
    const [data, sig] = token.split('.')
    const tamperedToken = `${data}.${sig.slice(0, -1)}X`
    expect(verifySessionToken(tamperedToken)).toBe(false)
  })

  it('rejects expired tokens', () => {
    vi.useFakeTimers()
    const token = generateSessionToken(testUserId, 1000) // 1 second expiry
    vi.advanceTimersByTime(2000)
    expect(verifySessionToken(token)).toBe(false)
    vi.useRealTimers()
  })

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('')).toBe(false)
    expect(verifySessionToken('no-dot')).toBe(false)
    expect(verifySessionToken('invalid.token')).toBe(false)
  })

  it('throws without secret configured', () => {
    process.env = { ...originalEnv }
    delete process.env.SITE_PASSWORD_HASH
    delete process.env.API_SECRET_KEY
    expect(() => generateSessionToken(testUserId)).toThrow('No secret configured')
  })

  it('extracts userId from valid token', () => {
    const token = generateSessionToken(testUserId)
    expect(getUserIdFromToken(token)).toBe(testUserId)
  })

  it('returns null for invalid token', () => {
    expect(getUserIdFromToken('invalid.token')).toBe(null)
    expect(getUserIdFromToken('')).toBe(null)
  })
})

describe('hashPassword and verifyPassword', () => {
  it('creates different hashes for same password', () => {
    const hash1 = hashPassword('mypassword')
    const hash2 = hashPassword('mypassword')
    expect(hash1).not.toBe(hash2) // Different salts
  })

  it('verifies correct password', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('correctpassword', hash)).toBe(true)
  })

  it('rejects incorrect password', () => {
    const hash = hashPassword('correctpassword')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('returns false for malformed hash', () => {
    expect(verifyPassword('password', 'nocolon')).toBe(false)
    expect(verifyPassword('password', '')).toBe(false)
  })
})

describe('sanitizeSearchInput', () => {
  it('passes through normal text', () => {
    expect(sanitizeSearchInput('hello world')).toBe('hello world')
    expect(sanitizeSearchInput('React hooks')).toBe('React hooks')
  })

  it('handles PostgREST wildcards', () => {
    // % gets escaped to \% then both get stripped by safe char filter
    expect(sanitizeSearchInput('100%')).toBe('100')
    // _ is a word character so it stays (escape backslash stripped)
    expect(sanitizeSearchInput('user_name')).toBe('user_name')
    // backslashes get doubled then stripped
    expect(sanitizeSearchInput('back\\slash')).toBe('backslash')
  })

  it('removes dangerous characters', () => {
    expect(sanitizeSearchInput('test;DROP TABLE')).toBe('testDROP TABLE')
    expect(sanitizeSearchInput('<script>alert(1)</script>')).toBe('scriptalert1script')
    expect(sanitizeSearchInput('query=value&other=2')).toBe('queryvalueother2')
  })

  it('allows safe punctuation', () => {
    expect(sanitizeSearchInput("it's fine")).toBe("it's fine")
    expect(sanitizeSearchInput('dash-case')).toBe('dash-case')
    expect(sanitizeSearchInput('3.14')).toBe('3.14')
  })

  it('truncates long input', () => {
    const longInput = 'a'.repeat(200)
    expect(sanitizeSearchInput(longInput).length).toBe(100)
  })
})
