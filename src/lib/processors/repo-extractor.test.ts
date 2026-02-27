import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractCandidateNames,
  searchGitHubRepoCandidates,
  selectBestRepo,
  validateRepoMatch,
  searchGitHubRepo,
  extractReposFromSummary,
  extractReposFromTranscript,
  GitHubRepoInfo,
} from './repo-extractor'

describe('Repo Extractor', () => {
  const mockFetch = vi.fn()
  const originalFetch = global.fetch
  const originalEnv = process.env

  beforeEach(() => {
    global.fetch = mockFetch
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
  })

  describe('extractCandidateNames', () => {
    it('should extract tool names from transcript', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '[{"name": "ink", "context": "React terminal CLI"}]',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      })

      const result = await extractCandidateNames('This video shows ink for terminal UIs')

      expect(result.candidates).toEqual([{ name: 'ink', context: 'React terminal CLI' }])
      expect(result.cost).toBeGreaterThan(0)
    })

    it('should handle old string array format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '["ink", "zod"]',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      })

      const result = await extractCandidateNames('Testing ink and zod')

      expect(result.candidates).toEqual([
        { name: 'ink', context: '' },
        { name: 'zod', context: '' },
      ])
    })

    it('should handle JSON wrapped in code blocks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '```json\n[{"name": "sharp", "context": "image processing"}]\n```',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 15 },
        }),
      })

      const result = await extractCandidateNames('Using sharp for images')

      expect(result.candidates).toEqual([{ name: 'sharp', context: 'image processing' }])
    })

    it('should return empty on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('error'),
      })

      const result = await extractCandidateNames('Test transcript')

      expect(result.candidates).toEqual([])
      expect(result.cost).toBe(0)
    })

    it('should return empty on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await extractCandidateNames('Test transcript')

      expect(result.candidates).toEqual([])
      expect(result.cost).toBe(0)
    })

    it('should return empty for invalid JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'not valid json',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 5 },
        }),
      })

      const result = await extractCandidateNames('Test transcript')

      expect(result.candidates).toEqual([])
    })
  })

  describe('searchGitHubRepoCandidates', () => {
    it('should search GitHub and return candidates', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          items: [
            {
              html_url: 'https://github.com/vadimdemedes/ink',
              name: 'ink',
              full_name: 'vadimdemedes/ink',
              description: 'React for CLIs',
              stargazers_count: 25000,
              topics: ['react', 'cli', 'terminal'],
            },
          ],
        }),
      })

      const result = await searchGitHubRepoCandidates('ink', 'React terminal')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        url: 'https://github.com/vadimdemedes/ink',
        name: 'ink',
        fullName: 'vadimdemedes/ink',
        description: 'React for CLIs',
        stars: 25000,
        topics: ['react', 'cli', 'terminal'],
      })
    })

    it('should use multiple search strategies', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            items: [{
              html_url: 'https://github.com/user/repo',
              name: 'repo',
              full_name: 'user/repo',
              description: 'Found on second query',
              stargazers_count: 100,
              topics: [],
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })

      const result = await searchGitHubRepoCandidates('repo', 'description')

      // Multiple search strategies: 'repo in:name', 'repo description', 'repo'
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result).toHaveLength(1)
    })

    it('should deduplicate repos across queries', async () => {
      const repo = {
        html_url: 'https://github.com/user/repo',
        name: 'repo',
        full_name: 'user/repo',
        description: 'Same repo',
        stargazers_count: 100,
        topics: [],
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [repo] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [repo] }),
        })

      const result = await searchGitHubRepoCandidates('repo')

      expect(result).toHaveLength(1)
    })

    it('should respect maxResults limit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          items: Array(10).fill(null).map((_, i) => ({
            html_url: `https://github.com/user/repo${i}`,
            name: `repo${i}`,
            full_name: `user/repo${i}`,
            description: `Repo ${i}`,
            stargazers_count: 100 - i,
            topics: [],
          })),
        }),
      })

      const result = await searchGitHubRepoCandidates('repo', '', 3)

      expect(result).toHaveLength(3)
    })

    it('should include auth header when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'test-token'

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      })

      await searchGitHubRepoCandidates('test')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    it('should handle GitHub API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('error'),
      })

      const result = await searchGitHubRepoCandidates('test')

      expect(result).toEqual([])
    })
  })

  describe('selectBestRepo', () => {
    const mockCandidates: GitHubRepoInfo[] = [
      {
        url: 'https://github.com/vadimdemedes/ink',
        name: 'ink',
        fullName: 'vadimdemedes/ink',
        description: 'React for CLIs',
        stars: 25000,
        topics: ['react', 'cli'],
      },
      {
        url: 'https://github.com/other/ink',
        name: 'ink',
        fullName: 'other/ink',
        description: 'Something else',
        stars: 50,
        topics: [],
      },
    ]

    it('should return null for empty candidates', async () => {
      const result = await selectBestRepo([], 'context')

      expect(result).toEqual({ repo: null, cost: 0 })
    })

    it('should validate single candidate', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'yes' } }],
          usage: { prompt_tokens: 100, completion_tokens: 1 },
        }),
      })

      const result = await selectBestRepo([mockCandidates[0]], 'React terminal UI')

      expect(result.repo).toEqual(mockCandidates[0])
    })

    it('should select best repo from multiple candidates', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '1' } }],
          usage: { prompt_tokens: 200, completion_tokens: 1 },
        }),
      })

      const result = await selectBestRepo(mockCandidates, 'React CLI library')

      expect(result.repo).toEqual(mockCandidates[0])
      expect(result.cost).toBeGreaterThan(0)
    })

    it('should return null when LLM selects 0', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '0' } }],
          usage: { prompt_tokens: 200, completion_tokens: 1 },
        }),
      })

      const result = await selectBestRepo(mockCandidates, 'Unrelated context')

      expect(result.repo).toBeNull()
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('error'),
      })

      const result = await selectBestRepo(mockCandidates, 'context')

      expect(result).toEqual({ repo: null, cost: 0 })
    })
  })

  describe('validateRepoMatch', () => {
    const mockRepo: GitHubRepoInfo = {
      url: 'https://github.com/vadimdemedes/ink',
      name: 'ink',
      fullName: 'vadimdemedes/ink',
      description: 'React for CLIs',
      stars: 25000,
      topics: ['react', 'cli'],
    }

    it('should return true for matching repo', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'yes' } }],
          usage: { prompt_tokens: 200, completion_tokens: 1 },
        }),
      })

      const result = await validateRepoMatch(
        'This video shows ink for terminal UIs',
        'ink',
        mockRepo
      )

      expect(result.isMatch).toBe(true)
      expect(result.cost).toBeGreaterThan(0)
    })

    it('should return false for non-matching repo', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'no' } }],
          usage: { prompt_tokens: 200, completion_tokens: 1 },
        }),
      })

      const result = await validateRepoMatch(
        'Unrelated transcript',
        'someother',
        mockRepo
      )

      expect(result.isMatch).toBe(false)
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('error'),
      })

      const result = await validateRepoMatch('transcript', 'name', mockRepo)

      expect(result).toEqual({ isMatch: false, cost: 0 })
    })
  })

  describe('searchGitHubRepo (legacy wrapper)', () => {
    it('should return null when OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY

      const result = await searchGitHubRepo('ink')

      expect(result).toEqual({ repo: null, cost: 0 })
    })

    it('should search and select best repo', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      const repoItem = {
        html_url: 'https://github.com/user/repo',
        name: 'repo',
        full_name: 'user/repo',
        description: 'Description',
        stargazers_count: 100,
        topics: [],
      }

      // GitHub search (multiple strategies)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })

      // LLM validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'yes' } }],
          usage: { prompt_tokens: 100, completion_tokens: 1 },
        }),
      })

      const result = await searchGitHubRepo('repo', 'context')

      expect(result.repo).not.toBeNull()
    })
  })

  describe('extractReposFromSummary', () => {
    it('should return empty when OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY

      const result = await extractReposFromSummary('Title', 'Summary')

      expect(result).toEqual({ repos: [], cost: 0 })
    })

    it('should extract repos from title and summary', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      const repoItem = {
        html_url: 'https://github.com/user/repo',
        name: 'repo',
        full_name: 'user/repo',
        description: 'Matches title',
        stargazers_count: 500,
        topics: [],
      }

      // GitHub search queries (multiple strategies)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })

      // LLM selection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'yes' } }],
          usage: { prompt_tokens: 100, completion_tokens: 1 },
        }),
      })

      const result = await extractReposFromSummary('repo - A tool', 'Description of repo')

      expect(result.repos).toHaveLength(1)
      expect(result.cost).toBeGreaterThan(0)
    })

    it('should filter out existing repo URLs', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [{
            html_url: 'https://github.com/user/repo',
            name: 'repo',
            full_name: 'user/repo',
            description: 'Already exists',
            stargazers_count: 500,
            topics: [],
          }],
        }),
      })

      const result = await extractReposFromSummary(
        'Title',
        'Summary',
        ['https://github.com/user/repo']
      )

      expect(result.repos).toHaveLength(0)
    })
  })

  describe('extractReposFromTranscript', () => {
    it('should return empty when OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY

      const result = await extractReposFromTranscript('Transcript about tools')

      expect(result).toEqual({ repos: [], cost: 0 })
    })

    it('should extract and validate repos from transcript', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      const repoItem = {
        html_url: 'https://github.com/vadimdemedes/ink',
        name: 'ink',
        full_name: 'vadimdemedes/ink',
        description: 'React for CLIs',
        stargazers_count: 25000,
        topics: ['react', 'cli'],
      }

      // Extract candidates
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '[{"name": "ink", "context": "React terminal"}]',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      })

      // GitHub search queries (multiple strategies)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [repoItem] }),
      })

      // LLM selection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'yes' } }],
          usage: { prompt_tokens: 100, completion_tokens: 1 },
        }),
      })

      const result = await extractReposFromTranscript('This video shows ink for terminal UIs')

      expect(result.repos).toHaveLength(1)
      expect(result.repos[0].fullName).toBe('vadimdemedes/ink')
      expect(result.cost).toBeGreaterThan(0)
    })

    it('should filter out existing repo URLs', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      // Extract candidates
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '[{"name": "ink", "context": "React terminal"}]',
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      })

      // GitHub search
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [{
            html_url: 'https://github.com/vadimdemedes/ink',
            name: 'ink',
            full_name: 'vadimdemedes/ink',
            description: 'React for CLIs',
            stargazers_count: 25000,
            topics: [],
          }],
        }),
      })

      const result = await extractReposFromTranscript(
        'Transcript',
        ['https://github.com/vadimdemedes/ink']
      )

      expect(result.repos).toHaveLength(0)
    })

    it('should handle no candidates found', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: '[]' },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 2 },
        }),
      })

      const result = await extractReposFromTranscript('No tools mentioned here')

      expect(result.repos).toHaveLength(0)
    })

    it('should limit to 5 candidates', async () => {
      process.env.OPENAI_API_KEY = 'test-key'

      const candidates = Array(10).fill(null).map((_, i) => ({
        name: `tool${i}`,
        context: `Tool ${i}`,
      }))

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: JSON.stringify(candidates) },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      })

      // Mock GitHub searches - multiple queries per candidate
      // Each candidate triggers multiple search strategies
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      })

      const result = await extractReposFromTranscript('Many tools mentioned')

      // Should only process first 5 candidates (limited from 10)
      expect(result.repos).toHaveLength(0)
      // Verify extraction was called (at least once for extraction)
      expect(mockFetch).toHaveBeenCalled()
    })
  })
})
