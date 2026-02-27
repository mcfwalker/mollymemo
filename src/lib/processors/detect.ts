// Detect source type from URL

export type SourceType = 'tiktok' | 'github' | 'youtube' | 'x' | 'article'

export function detectSourceType(url: string): SourceType {
  const hostname = new URL(url).hostname.toLowerCase()

  if (hostname.includes('tiktok.com')) {
    return 'tiktok'
  }

  if (hostname === 'github.com') {
    return 'github'
  }

  if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
    return 'youtube'
  }

  if (hostname === 'x.com' || hostname === 'twitter.com') {
    return 'x'
  }

  return 'article'
}

// Extract GitHub owner/repo from URL
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/?\s#]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

// Extract and deduplicate GitHub URLs from text (transcripts, articles, posts)
export function extractGitHubUrls(text: string): string[] {
  const matches = text.match(/github\.com\/[^\s"'<>,.]+/gi) || []
  return [...new Set(
    matches.map(m => `https://${m.replace(/[.,;:!?)]+$/, '')}`)
  )]
}
