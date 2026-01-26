import { describe, it, expect } from 'vitest'
import { detectSourceType, parseGitHubUrl } from './detect'

describe('detectSourceType', () => {
  it('detects TikTok URLs', () => {
    expect(detectSourceType('https://www.tiktok.com/@user/video/123')).toBe('tiktok')
    expect(detectSourceType('https://tiktok.com/@user/video/123')).toBe('tiktok')
    expect(detectSourceType('https://vm.tiktok.com/abc123')).toBe('tiktok')
  })

  it('detects GitHub URLs', () => {
    expect(detectSourceType('https://github.com/owner/repo')).toBe('github')
    expect(detectSourceType('https://github.com/owner/repo/issues/1')).toBe('github')
  })

  it('detects YouTube URLs', () => {
    expect(detectSourceType('https://www.youtube.com/watch?v=abc123')).toBe('youtube')
    expect(detectSourceType('https://youtube.com/watch?v=abc123')).toBe('youtube')
    expect(detectSourceType('https://youtu.be/abc123')).toBe('youtube')
  })

  it('detects X/Twitter URLs', () => {
    expect(detectSourceType('https://x.com/user/status/123')).toBe('x')
    expect(detectSourceType('https://twitter.com/user/status/123')).toBe('x')
  })

  it('defaults to article for unknown URLs', () => {
    expect(detectSourceType('https://example.com/article')).toBe('article')
    expect(detectSourceType('https://medium.com/post')).toBe('article')
    expect(detectSourceType('https://dev.to/post')).toBe('article')
  })

  it('throws for invalid URLs', () => {
    expect(() => detectSourceType('not-a-url')).toThrow()
  })
})

describe('parseGitHubUrl', () => {
  it('parses owner and repo from GitHub URLs', () => {
    expect(parseGitHubUrl('https://github.com/anthropics/claude-code')).toEqual({
      owner: 'anthropics',
      repo: 'claude-code',
    })
  })

  it('handles URLs with additional path segments', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/issues/1')).toEqual({
      owner: 'owner',
      repo: 'repo',
    })
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main/src')).toEqual({
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('strips .git suffix from repo name', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('handles query strings and fragments', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo?tab=readme')).toEqual({
      owner: 'owner',
      repo: 'repo',
    })
    expect(parseGitHubUrl('https://github.com/owner/repo#readme')).toEqual({
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull()
    expect(parseGitHubUrl('https://example.com')).toBeNull()
  })

  it('returns null for GitHub URLs without repo', () => {
    expect(parseGitHubUrl('https://github.com/owner')).toBeNull()
    expect(parseGitHubUrl('https://github.com')).toBeNull()
  })
})
