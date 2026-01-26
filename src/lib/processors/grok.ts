// Grok API integration for X content and JS-rendered articles

interface GrokResponse {
  content: string
  citations: string[]
}

interface GrokXContent {
  text: string
  authorName: string | null
  summary: string
  citations: string[]
}

// Fetch and summarize X content using Grok's x_search tool
export async function fetchXContentWithGrok(url: string): Promise<GrokXContent | null> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    console.error('XAI_API_KEY not configured')
    return null
  }

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast',
        input: [
          {
            role: 'user',
            content: `Fetch and analyze this X/Twitter URL: ${url}

Please provide:
1. The full text content of the post/thread/article
2. The author's name/handle
3. A concise summary (2-3 sentences) of the key points
4. Any GitHub repositories or tools mentioned

Format your response as JSON:
{
  "fullText": "the complete text content",
  "authorName": "author name or handle",
  "summary": "concise summary",
  "mentionedRepos": ["repo1", "repo2"],
  "mentionedTools": ["tool1", "tool2"]
}`
          }
        ],
        tools: [
          {
            type: 'x_search',
            enable_image_understanding: true,
            enable_video_understanding: true,
          }
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`Grok API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    console.log('Grok API raw response:', JSON.stringify(data, null, 2))

    // Extract the response content - try multiple paths
    const content = data.output?.[0]?.content
      || data.output?.content
      || data.choices?.[0]?.message?.content
      || data.content
      || ''
    const citations = data.citations || data.output?.citations || []

    console.log('Grok extracted content:', content?.slice(0, 500))
    console.log('Grok citations:', citations)

    // Try to parse as JSON, fall back to raw content
    let parsed
    try {
      // Extract JSON from the response (may be wrapped in markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
        console.log('Grok parsed JSON:', parsed)
      }
    } catch (parseError) {
      console.error('Grok JSON parse error:', parseError)
      parsed = null
    }

    if (parsed) {
      return {
        text: parsed.fullText || content,
        authorName: parsed.authorName || null,
        summary: parsed.summary || '',
        citations: [...citations, ...(parsed.mentionedRepos || [])],
      }
    }

    return {
      text: content,
      authorName: null,
      summary: content.slice(0, 200),
      citations,
    }
  } catch (error) {
    console.error('Grok X fetch error:', error)
    return null
  }
}

// Fetch and summarize a web article using Grok's web_search tool
export async function fetchArticleWithGrok(url: string): Promise<GrokResponse | null> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    console.error('XAI_API_KEY not configured')
    return null
  }

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast',
        input: [
          {
            role: 'user',
            content: `Browse and analyze this URL: ${url}

Please provide:
1. The article title
2. A concise summary (2-3 sentences) of the key points
3. Any GitHub repositories, tools, or techniques mentioned

Format your response as JSON:
{
  "title": "article title",
  "summary": "concise summary",
  "mentionedRepos": ["repo1", "repo2"],
  "mentionedTools": ["tool1", "tool2"]
}`
          }
        ],
        tools: [
          {
            type: 'web_search',
            enable_image_understanding: true,
          }
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`Grok API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()

    const content = data.output?.[0]?.content || data.choices?.[0]?.message?.content || ''
    const citations = data.citations || []

    return {
      content,
      citations,
    }
  } catch (error) {
    console.error('Grok article fetch error:', error)
    return null
  }
}
