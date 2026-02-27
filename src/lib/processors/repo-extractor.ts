// Shared smart repo extraction logic
// Extracts candidate names from transcript, searches GitHub, validates matches

import { chatCompletion, parseJsonResponse } from '../openai-client'
import logger from '@/lib/logger'

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
  transcript: string
): Promise<{ candidates: CandidateRepo[]; cost: number }> {
  try {
    const completion = await chatCompletion(
      [{
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
      { temperature: 0, maxTokens: 300 }
    )

    if (!completion) return { candidates: [], cost: 0 }

    const { cost } = completion
    const parsed = parseJsonResponse(completion.text)

    // Handle both old format (string[]) and new format (CandidateRepo[])
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === 'string') {
        return { candidates: parsed.map((name: string) => ({ name, context: '' })), cost }
      }
      return { candidates: parsed, cost }
    }
    return { candidates: [], cost }
  } catch (error) {
    logger.error({ err: error }, 'Candidate name extraction error')
    return { candidates: [], cost: 0 }
  }
}

// Search GitHub and return multiple candidates for LLM selection
export async function searchGitHubRepoCandidates(
  name: string,
  context: string = '',
  maxResults: number = 5
): Promise<GitHubRepoInfo[]> {
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'MollyMemo',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const candidates: GitHubRepoInfo[] = []
  const seenFullNames = new Set<string>()

  // Build search queries - try multiple strategies
  const queries = context
    ? [`${name} in:name`, `${name} ${context}`, name]
    : [`${name} in:name`, name]

  for (const query of queries) {
    if (candidates.length >= maxResults) break

    try {
      logger.info({ query }, 'GitHub search')
      const response = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10&sort=stars&order=desc`,
        { headers }
      )

      if (!response.ok) {
        logger.error({ status: response.status }, 'GitHub search error')
        continue
      }

      const data = await response.json()
      if (data.items && data.items.length > 0) {
        for (const repo of data.items) {
          if (candidates.length >= maxResults) break
          if (seenFullNames.has(repo.full_name)) continue

          seenFullNames.add(repo.full_name)
          candidates.push({
            url: repo.html_url,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            stars: repo.stargazers_count,
            topics: repo.topics || [],
          })
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'GitHub search error')
    }
  }

  return candidates
}

// LLM selects the best matching repo from candidates based on context
export async function selectBestRepo(
  candidates: GitHubRepoInfo[],
  context: string
): Promise<{ repo: GitHubRepoInfo | null; cost: number }> {
  if (candidates.length === 0) return { repo: null, cost: 0 }
  if (candidates.length === 1) {
    // Still validate single candidate
    const { isMatch, cost } = await validateRepoMatch(context, '', candidates[0])
    return { repo: isMatch ? candidates[0] : null, cost }
  }

  try {
    const repoList = candidates.map((repo, i) =>
      `${i + 1}. ${repo.fullName} (${repo.stars.toLocaleString()} stars)\n   Description: ${repo.description || 'No description'}\n   Topics: ${repo.topics.join(', ') || 'None'}`
    ).join('\n\n')

    const completion = await chatCompletion(
      [{
        role: 'user',
        content: `Which GitHub repository best matches what's described in this context?

Context:
${context.slice(0, 2000)}

Candidate repositories:
${repoList}

Instructions:
- Select the repository that best matches what's being discussed
- Consider: Does the description match? Is the functionality aligned? Is it a well-known project?
- If NONE of the repositories match what's described, respond with "0"
- Otherwise, respond with ONLY the number (1-${candidates.length}) of the best match`
      }],
      { temperature: 0, maxTokens: 10 }
    )

    if (!completion) return { repo: null, cost: 0 }

    const { cost } = completion
    const selection = parseInt(completion.text.trim(), 10)

    logger.info({ selection: completion.text.trim(), candidateCount: candidates.length }, 'LLM selected repo')

    if (selection >= 1 && selection <= candidates.length) {
      return { repo: candidates[selection - 1], cost }
    }

    return { repo: null, cost }
  } catch (error) {
    logger.error({ err: error }, 'LLM selection error')
    return { repo: null, cost: 0 }
  }
}

// Legacy wrapper for compatibility - uses new LLM selection
export async function searchGitHubRepo(
  name: string,
  context: string = ''
): Promise<{ repo: GitHubRepoInfo | null; cost: number }> {
  const candidates = await searchGitHubRepoCandidates(name, context)
  if (candidates.length === 0) return { repo: null, cost: 0 }

  const searchContext = context ? `Looking for: ${name} - ${context}` : `Looking for: ${name}`
  return selectBestRepo(candidates, searchContext)
}

// Validate if a GitHub repo matches what's described in the transcript
export async function validateRepoMatch(
  transcript: string,
  candidateName: string,
  repo: GitHubRepoInfo
): Promise<{ isMatch: boolean; cost: number }> {
  try {
    const completion = await chatCompletion(
      [{
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
      { temperature: 0, maxTokens: 10 }
    )

    if (!completion) return { isMatch: false, cost: 0 }

    return { isMatch: completion.text.trim().toLowerCase() === 'yes', cost: completion.cost }
  } catch (error) {
    logger.error({ err: error }, 'Repo validation error')
    return { isMatch: false, cost: 0 }
  }
}

// Second pass: use title + summary to find repos that initial extraction missed
// This catches transcription errors like "Inc" -> "Ink"
export async function extractReposFromSummary(
  title: string,
  summary: string,
  existingRepoUrls: string[] = []
): Promise<{ repos: GitHubRepoInfo[]; cost: number }> {
  logger.info({ preview: `${title} ${summary}`.slice(0, 100) }, 'Second pass repo search with summary')

  // Get multiple candidates from GitHub
  const candidates = await searchGitHubRepoCandidates(title, summary, 5)
  if (candidates.length === 0) {
    logger.info('No repo candidates found in second pass')
    return { repos: [], cost: 0 }
  }

  // Filter out already extracted repos
  const newCandidates = candidates.filter(
    c => !existingRepoUrls.some(url => url.includes(c.fullName))
  )
  if (newCandidates.length === 0) {
    logger.info('All candidates already extracted')
    return { repos: [], cost: 0 }
  }

  logger.info({ count: newCandidates.length, candidates: newCandidates.map(c => c.fullName) }, 'Second pass found candidates')

  // LLM selects the best match based on context
  const context = `Title: ${title}\nDescription: ${summary}`
  const { repo: selected, cost } = await selectBestRepo(newCandidates, context)

  if (selected) {
    logger.info({ repo: selected.fullName }, 'Second pass selected')
    return { repos: [selected], cost }
  }

  logger.info('Second pass: LLM found no matching repo')
  return { repos: [], cost }
}

// Main function: extract repos from transcript with LLM selection
export async function extractReposFromTranscript(
  transcript: string,
  existingRepoUrls: string[] = []
): Promise<{ repos: GitHubRepoInfo[]; cost: number }> {
  let totalCost = 0

  // Extract candidate names with context
  const { candidates, cost: extractionCost } = await extractCandidateNames(transcript)
  totalCost += extractionCost
  logger.info({ candidates }, 'Repo extraction candidates')

  if (candidates.length === 0) {
    return { repos: [], cost: totalCost }
  }

  const validatedRepos: GitHubRepoInfo[] = []

  // Search and select best repo for each candidate (limit to 5)
  for (const candidate of candidates.slice(0, 5)) {
    // Get multiple GitHub candidates
    const githubCandidates = await searchGitHubRepoCandidates(candidate.name, candidate.context, 5)

    // Filter out already extracted repos
    const newCandidates = githubCandidates.filter(
      c => !existingRepoUrls.some(url => url.includes(c.fullName)) &&
           !validatedRepos.some(r => r.fullName === c.fullName)
    )

    if (newCandidates.length === 0) continue

    // LLM selects the best match
    const context = `Transcript mentioning "${candidate.name}":\n${transcript.slice(0, 1500)}\n\nLooking for: ${candidate.name} - ${candidate.context}`
    const { repo: selected, cost: selectionCost } = await selectBestRepo(newCandidates, context)
    totalCost += selectionCost

    if (selected) {
      logger.info({ repo: selected.fullName, candidate: candidate.name }, 'Selected repo for candidate')
      validatedRepos.push(selected)
    }
  }

  return { repos: validatedRepos, cost: totalCost }
}
