// Shared smart repo extraction logic
// Extracts candidate names from transcript, searches GitHub, validates matches

export interface GitHubRepoInfo {
  url: string
  name: string
  fullName: string
  description: string | null
  stars: number
  topics: string[]
}

export interface CandidateRepo {
  name: string
  context: string // e.g., "React terminal UI library"
}

// Extract tool/project names with context that might be GitHub repos
export async function extractCandidateNames(
  transcript: string,
  apiKey: string
): Promise<CandidateRepo[]> {
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
          content: `Extract names of software tools, libraries, CLI tools, or projects mentioned in this transcript that could potentially be open source GitHub repositories.

Rules:
- Include specific tool/project names (e.g., "repeater", "sharp", "ffmpeg", "ink", "zod")
- IMPORTANT: This is an audio transcript, so names may be misspelled. Correct likely transcription errors:
  - "Inc" when describing React terminal UIs is probably "Ink"
  - "Zod" might be transcribed as "Zaud" or "Sod"
  - Think about what the actual GitHub repo name would be
- For each name, include 2-4 keywords describing what it does (for better GitHub search)
- Do NOT include well-known commercial services (e.g., "ChatGPT", "Figma", "Notion", "AWS", "Discord", "Telegram", "WhatsApp")
- Do NOT include generic terms (e.g., "terminal", "algorithm", "app", "bot")
- Return a JSON array of objects with "name" (corrected spelling) and "context" fields. If none found, return [].

Example output:
[{"name": "ink", "context": "React terminal CLI components"}, {"name": "sharp", "context": "image processing Node.js"}]

Transcript:
${transcript.slice(0, 3000)}`
        }],
        temperature: 0,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      console.error('AI extraction error:', response.status)
      return []
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Handle both old format (string[]) and new format (CandidateRepo[])
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === 'string') {
        return parsed.map((name: string) => ({ name, context: '' }))
      }
      return parsed
    }
    return []
  } catch (error) {
    console.error('Candidate name extraction error:', error)
    return []
  }
}

// Search GitHub for a repo and return full metadata
// Tries multiple search strategies: name+context first, then name only
export async function searchGitHubRepo(
  name: string,
  context: string = ''
): Promise<GitHubRepoInfo | null> {
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'LazyList',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Build search queries - try multiple strategies
  // 1. name + context (most specific)
  // 2. just context (catches misspelled names)
  // 3. just name (fallback)
  const queries = context
    ? [`${name} ${context}`, context, name]
    : [name]

  for (const query of queries) {
    try {
      console.log(`GitHub search: "${query}"`)
      const response = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10&sort=stars&order=desc`,
        { headers }
      )

      if (!response.ok) {
        console.error('GitHub search error:', response.status)
        continue
      }

      const data = await response.json()
      if (data.items && data.items.length > 0) {
        // Return the best match (highest stars among results)
        const sorted = data.items.sort(
          (a: { stargazers_count: number }, b: { stargazers_count: number }) =>
            b.stargazers_count - a.stargazers_count
        )
        const repo = sorted[0]
        return {
          url: repo.html_url,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          topics: repo.topics || [],
        }
      }
    } catch (error) {
      console.error('GitHub search error:', error)
    }
  }

  return null
}

// Validate if a GitHub repo matches what's described in the transcript
export async function validateRepoMatch(
  transcript: string,
  candidateName: string,
  repo: GitHubRepoInfo,
  apiKey: string
): Promise<boolean> {
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
          content: `Determine if this GitHub repository is the one being discussed in the transcript.

Transcript excerpt (discussing "${candidateName}"):
${transcript.slice(0, 2000)}

GitHub Repository:
- Name: ${repo.fullName}
- Description: ${repo.description || 'No description'}
- Topics: ${repo.topics.join(', ') || 'None'}
- Stars: ${repo.stars}

Question: Is this GitHub repository "${repo.fullName}" the actual project/tool being discussed in the transcript as "${candidateName}"?

Consider:
- Does the repo description match what the transcript describes?
- Is the repo name similar to what's mentioned (account for transcription errors)?
- Does the functionality align?

Respond with ONLY "yes" or "no".`
        }],
        temperature: 0,
        max_tokens: 10,
      }),
    })

    if (!response.ok) {
      console.error('Validation error:', response.status)
      return false
    }

    const data = await response.json()
    const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase() || ''
    return answer === 'yes'
  } catch (error) {
    console.error('Repo validation error:', error)
    return false
  }
}

// Second pass: use title + summary to find repos that initial extraction missed
// This catches transcription errors like "Inc" -> "Ink"
export async function extractReposFromSummary(
  title: string,
  summary: string,
  existingRepoUrls: string[] = []
): Promise<GitHubRepoInfo[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured for repo extraction')
    return []
  }

  // Combine title and summary for search
  const searchQuery = `${title} ${summary}`
  console.log('Second pass repo search with summary:', searchQuery.slice(0, 100))

  // Search GitHub directly with the summary
  const repo = await searchGitHubRepo(title, summary)
  if (!repo) {
    console.log('No repo found in second pass')
    return []
  }

  // Skip if already extracted
  if (existingRepoUrls.some(url => url.includes(repo.fullName))) {
    console.log(`Skipping ${repo.fullName} - already extracted`)
    return []
  }

  // Validate: does this repo match what the summary describes?
  const isMatch = await validateRepoMatch(
    `Title: ${title}\nSummary: ${summary}`,
    title,
    repo,
    apiKey
  )
  console.log(`Second pass validation for ${title} -> ${repo.fullName}: ${isMatch}`)

  if (isMatch) {
    return [repo]
  }

  return []
}

// Main function: extract repos from transcript with validation
export async function extractReposFromTranscript(
  transcript: string,
  existingRepoUrls: string[] = []
): Promise<GitHubRepoInfo[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured for repo extraction')
    return []
  }

  // Extract candidate names with context
  const candidates = await extractCandidateNames(transcript, apiKey)
  console.log('Repo extraction candidates:', candidates)

  if (candidates.length === 0) {
    return []
  }

  const validatedRepos: GitHubRepoInfo[] = []

  // Search and validate each candidate (limit to 5)
  for (const candidate of candidates.slice(0, 5)) {
    const repo = await searchGitHubRepo(candidate.name, candidate.context)
    if (repo) {
      // Skip if we already have this repo
      if (existingRepoUrls.some(url => url.includes(repo.fullName))) {
        console.log(`Skipping ${repo.fullName} - already extracted`)
        continue
      }

      // Validate that this repo matches the transcript context
      const isMatch = await validateRepoMatch(transcript, candidate.name, repo, apiKey)
      console.log(`Repo validation for ${candidate.name} -> ${repo.fullName}: ${isMatch}`)

      if (isMatch) {
        validatedRepos.push(repo)
      }
    }
  }

  return validatedRepos
}
