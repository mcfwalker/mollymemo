import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit, sanitizeSearchInput } from './security'

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
