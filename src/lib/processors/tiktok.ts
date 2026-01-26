// TikTok processor using OpenAI for transcription

interface TikTokResult {
  transcript: string
  extractedUrls: string[]
}

// Get direct video URL from TikTok using tikwm API
async function getTikTokVideoUrl(tiktokUrl: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(tiktokUrl)}`,
    })

    if (!response.ok) {
      console.error('tikwm API error:', response.status)
      return null
    }

    const data = await response.json()
    const videoUrl = data?.data?.play || data?.data?.hdplay || data?.data?.wmplay

    if (!videoUrl) {
      console.error('No video URL in tikwm response:', JSON.stringify(data))
      return null
    }

    return videoUrl
  } catch (error) {
    console.error('Error getting TikTok video URL:', error)
    return null
  }
}

// Transcribe video using OpenAI's GPT-4o Mini Transcribe
async function transcribeWithOpenAI(
  videoUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    // Download video first (OpenAI requires file upload)
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) {
      console.error('Failed to download video:', videoResponse.status)
      return null
    }

    const videoBlob = await videoResponse.blob()
    const formData = new FormData()
    formData.append('file', videoBlob, 'video.mp4')
    formData.append('model', 'gpt-4o-mini-transcribe')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`OpenAI transcription error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    return data.text || null
  } catch (error) {
    console.error('Transcription error:', error)
    return null
  }
}

// Extract repo names from transcript using AI
async function extractRepoNames(
  transcript: string,
  apiKey: string
): Promise<string[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Extract GitHub repository names ONLY if they are explicitly mentioned as GitHub repos in this transcript.

Rules:
- Only include repos mentioned with "github", "repo", "repository", or in "owner/repo" format
- Do NOT include general tool names, apps, or services (e.g., "Nanobanana" is a service, not a repo)
- Do NOT guess - if unsure, don't include it
- Return ONLY a JSON array of repo names (e.g., ["owner/repo-name"]). If no repos are explicitly mentioned, return [].

Transcript:
${transcript.slice(0, 2000)}`
        }],
        temperature: 0,
        max_tokens: 200,
      }),
    })

    if (!response.ok) {
      console.error('AI extraction error:', response.status)
      return []
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr)
  } catch (error) {
    console.error('Repo name extraction error:', error)
    return []
  }
}

// Search GitHub for a repo by name
async function searchGitHubRepo(repoName: string): Promise<string | null> {
  try {
    const token = process.env.GITHUB_TOKEN
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'LazyList',
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(repoName)}&per_page=1`,
      { headers }
    )

    if (!response.ok) {
      console.error('GitHub search error:', response.status)
      return null
    }

    const data = await response.json()
    if (data.items && data.items.length > 0) {
      return data.items[0].html_url
    }
    return null
  } catch (error) {
    console.error('GitHub search error:', error)
    return null
  }
}

export async function processTikTok(url: string): Promise<TikTokResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

  try {
    // Step 1: Get direct video URL from TikTok
    const videoUrl = await getTikTokVideoUrl(url)
    if (!videoUrl) {
      console.error('Could not get TikTok video URL')
      return null
    }

    // Step 2: Transcribe with OpenAI
    const transcript = await transcribeWithOpenAI(videoUrl, apiKey)
    if (!transcript) {
      console.error('Transcription failed')
      return null
    }

    // Step 3: Extract GitHub URLs from transcript (explicit URLs)
    const githubUrlPattern = /github\.com\/[^\s"'<>,.]+/gi
    const urlMatches = transcript.match(githubUrlPattern) || []
    const explicitUrls = [...new Set(urlMatches.map((m: string) =>
      `https://${m.replace(/[.,;:!?)]+$/, '')}` // Clean trailing punctuation
    ))]

    // Step 4: If no explicit URLs, try AI extraction of repo names
    let extractedUrls = explicitUrls
    if (explicitUrls.length === 0) {
      const repoNames = await extractRepoNames(transcript, apiKey)
      const searchedUrls: string[] = []

      // Search GitHub for each repo name (limit to 3)
      for (const name of repoNames.slice(0, 3)) {
        const repoUrl = await searchGitHubRepo(name)
        if (repoUrl) {
          searchedUrls.push(repoUrl)
        }
      }

      extractedUrls = searchedUrls
    }

    return {
      transcript,
      extractedUrls,
    }
  } catch (error) {
    console.error('TikTok processing error:', error)
    return null
  }
}
