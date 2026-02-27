// AI classifier using OpenAI GPT-4o mini

import { domains, defaultDomain, getDomainPromptList } from '../config/domains'
import { chatCompletion, parseJsonResponse } from '../openai-client'
import logger from '@/lib/logger'

interface ClassificationResult {
  title: string
  summary: string
  domain: string
  content_type: string
  tags: string[]
  cost: number
}

export async function classify(content: {
  sourceType: string
  sourceUrl?: string
  transcript?: string
  githubMetadata?: {
    name: string
    description: string | null
    topics: string[]
  }
  pageContent?: string
}): Promise<ClassificationResult | null> {
  // Guard: refuse to classify when there's no meaningful content
  const hasContent = content.transcript || content.githubMetadata || content.pageContent
  if (!hasContent) {
    logger.error('Classifier skipped: no transcript, metadata, or page content provided')
    return null
  }

  // Build context for the AI
  let context = `Source type: ${content.sourceType}\n`

  if (content.sourceUrl) {
    context += `Source URL: ${content.sourceUrl}\n`
  }

  context += '\n'

  if (content.transcript) {
    context += `Transcript:\n${content.transcript.slice(0, 3000)}\n\n`
  }

  if (content.githubMetadata) {
    context += `GitHub repo: ${content.githubMetadata.name}\n`
    context += `Description: ${content.githubMetadata.description || 'None'}\n`
    context += `Topics: ${content.githubMetadata.topics.join(', ') || 'None'}\n\n`
  }

  if (content.pageContent) {
    context += `Page content:\n${content.pageContent.slice(0, 3000)}\n\n`
  }

  const domainList = getDomainPromptList()
  const validDomains = [...Object.keys(domains), defaultDomain].map(d => `"${d}"`).join(', ')

  const prompt = `Analyze this content and classify it.

${context}

Return a JSON object with:
- title: A concise title (max 60 chars). For repos, use the repo name. For techniques, describe the technique.
- summary: One sentence summary (max 150 chars) of what this is and why it's useful.
- domain: One of ${validDomains}. Choose the best match:
  ${domainList}
- content_type: One of "repo", "technique", "tool", "resource", "person".
  - repo = GitHub repository
  - technique = A method, pattern, or approach
  - tool = A product or service (not open source)
  - resource = An article, tutorial, or reference
  - person = A creator or expert to follow
- tags: Array of 3-5 relevant tags (lowercase, hyphenated)

Return ONLY valid JSON, no markdown or explanation.`

  try {
    const completion = await chatCompletion([{ role: 'user', content: prompt }])
    if (!completion) return null

    const { text, cost } = completion
    const result = parseJsonResponse(text) as {
      domain?: string
      title?: string
      summary?: string
      content_type?: string
      tags?: string[]
    }

    // Validate domain against configured domains
    const validDomainSet = new Set([...Object.keys(domains), defaultDomain])
    const returnedDomain = result.domain && validDomainSet.has(result.domain) ? result.domain : defaultDomain

    return {
      title: result.title || 'Untitled',
      summary: result.summary || '',
      domain: returnedDomain,
      content_type: result.content_type || 'resource',
      tags: result.tags || [],
      cost,
    }
  } catch (error) {
    logger.error({ err: error }, 'Classification error')
    return null
  }
}
