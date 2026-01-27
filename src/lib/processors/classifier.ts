// AI classifier using OpenAI GPT-4o mini

import { domains, defaultDomain, getDomainPromptList } from '../config/domains'

interface ClassificationResult {
  title: string
  summary: string
  domain: string
  content_type: string
  tags: string[]
}

export async function classify(content: {
  sourceType: string
  transcript?: string
  githubMetadata?: {
    name: string
    description: string | null
    topics: string[]
  }
  pageContent?: string
}): Promise<ClassificationResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

  // Build context for the AI
  let context = `Source type: ${content.sourceType}\n\n`

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`OpenAI API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content

    if (!text) {
      console.error('No response from OpenAI')
      return null
    }

    // Parse JSON (handle potential markdown code blocks)
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const result = JSON.parse(jsonStr)

    // Validate domain against configured domains
    const validDomainSet = new Set([...Object.keys(domains), defaultDomain])
    const returnedDomain = validDomainSet.has(result.domain) ? result.domain : defaultDomain

    return {
      title: result.title || 'Untitled',
      summary: result.summary || '',
      domain: returnedDomain,
      content_type: result.content_type || 'resource',
      tags: result.tags || [],
    }
  } catch (error) {
    console.error('Classification error:', error)
    return null
  }
}
