// Grok API integration for X content and JS-rendered articles

interface GrokResponse {
  content: string
  citations: string[]
}

interface GrokXContent {
  text: string
  videoTranscript: string | null
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
2. If there is a video, provide a COMPLETE TRANSCRIPTION of all spoken audio
3. The author's name/handle
4. A concise summary (2-3 sentences) of the key points
5. Any GitHub repositories or tools mentioned

Format your response as JSON:
{
  "fullText": "the complete text content of the post",
  "videoTranscript": "full transcription of video audio, or null if no video",
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

    // Find the assistant message in the output array
    // Output contains tool calls followed by the final message
    const outputArray = data.output || []
    const assistantMessage = outputArray.find(
      (item: { type?: string; role?: string }) => item.type === 'message' && item.role === 'assistant'
    )

    // Extract text from the message content array
    const contentArray = assistantMessage?.content || []
    const textContent = contentArray.find(
      (item: { type?: string }) => item.type === 'output_text'
    )
    const content = textContent?.text || ''

    // Extract citations from annotations
    const annotations = textContent?.annotations || []
    const citations = annotations
      .filter((a: { type?: string }) => a.type === 'url_citation')
      .map((a: { url?: string }) => a.url)
      .filter(Boolean)

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
      // Convert repo names (e.g., "owner/repo") to full GitHub URLs
      const repoUrls = (parsed.mentionedRepos || []).map((repo: string) => {
        if (repo.includes('github.com')) return repo
        if (repo.includes('/')) return `https://github.com/${repo}`
        return repo // Single name, can't convert
      })

      // Deduplicate citations + repo URLs
      const allCitations = [...new Set([...citations, ...repoUrls])]

      return {
        text: parsed.fullText || content,
        videoTranscript: parsed.videoTranscript || null,
        authorName: parsed.authorName || null,
        summary: parsed.summary || '',
        citations: allCitations,
      }
    }

    return {
      text: content,
      videoTranscript: null,
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

    // Find the assistant message in the output array
    const outputArray = data.output || []
    const assistantMessage = outputArray.find(
      (item: { type?: string; role?: string }) => item.type === 'message' && item.role === 'assistant'
    )

    // Extract text from the message content array
    const contentArray = assistantMessage?.content || []
    const textContent = contentArray.find(
      (item: { type?: string }) => item.type === 'output_text'
    )
    const content = textContent?.text || ''

    // Extract citations from annotations
    const annotations = textContent?.annotations || []
    const citations = annotations
      .filter((a: { type?: string }) => a.type === 'url_citation')
      .map((a: { url?: string }) => a.url)
      .filter(Boolean)

    return {
      content,
      citations,
    }
  } catch (error) {
    console.error('Grok article fetch error:', error)
    return null
  }
}
