// GitHub repo processor

import { parseGitHubUrl } from './detect'
import logger from '@/lib/logger'

interface GitHubMetadata {
  name: string
  description: string | null
  stars: number
  language: string | null
  topics: string[]
  owner: string
  repo: string
}

export async function processGitHub(url: string): Promise<GitHubMetadata | null> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return null

  const { owner, repo } = parsed

  try {
    const headers: HeadersInit = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'MollyMemo/0.1',
    }

    // Add auth if available for higher rate limits
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'GitHub API error')
      return null
    }

    const data = await response.json()

    return {
      name: data.name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      topics: data.topics || [],
      owner,
      repo,
    }
  } catch (error) {
    logger.error({ err: error }, 'GitHub processing error')
    return null
  }
}
