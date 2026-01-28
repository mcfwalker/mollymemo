// Main processor that orchestrates extraction and classification

import { createServiceClient, Item } from '../supabase'
import { detectSourceType, parseGitHubUrl } from './detect'
import { processGitHub } from './github'
import { processTikTok } from './tiktok'
import { processX } from './x'
// Dynamic import to avoid JSDOM ESM issues on Vercel
// import { processArticle } from './article'
import { extractReposFromTranscript, extractReposFromSummary } from './repo-extractor'
import { classify } from './classifier'

export async function processItem(itemId: string): Promise<void> {
  const supabase = createServiceClient()

  // Get the item
  const { data: item, error: fetchError } = await supabase
    .from('items')
    .select('*')
    .eq('id', itemId)
    .single()

  if (fetchError || !item) {
    console.error('Failed to fetch item:', fetchError)
    return
  }

  // Mark as processing
  await supabase
    .from('items')
    .update({ status: 'processing' })
    .eq('id', itemId)

  try {
    const sourceType = item.source_type
    let transcript: string | undefined
    let githubMetadata: Awaited<ReturnType<typeof processGitHub>> = null
    let extractedEntities: Item['extracted_entities'] = { repos: [], tools: [], techniques: [] }
    let grokCost = 0
    let openaiCost = 0

    // Process based on source type
    if (sourceType === 'tiktok') {
      const result = await processTikTok(item.source_url)
      if (!result || !result.transcript) {
        throw new Error('TikTok transcription failed - no transcript returned')
      }
      transcript = result.transcript

      // Process any GitHub URLs found in the transcript
      for (const url of result.extractedUrls.slice(0, 3)) { // Limit to 3
        const gh = await processGitHub(url)
        if (gh) {
          extractedEntities.repos?.push(url)
          // Use the first repo's metadata for classification context
          if (!githubMetadata) {
            githubMetadata = gh
          }
        }
      }
    } else if (sourceType === 'github') {
      githubMetadata = await processGitHub(item.source_url)
      if (!githubMetadata) {
        throw new Error('GitHub metadata fetch failed')
      }
    } else if (sourceType === 'x') {
      const xData = await processX(item.source_url)
      if (!xData) {
        throw new Error('X/Twitter fetch failed')
      }
      grokCost = xData.grokCost
      // Use tweet text + video transcript for classification
      if (xData.videoTranscript) {
        transcript = `[Post]: ${xData.text}\n\n[Video Transcript]: ${xData.videoTranscript}`
      } else {
        transcript = xData.text
      }

      // If Grok was used, we have full content access (including X Articles)
      if (xData.usedGrok) {
        // Grok already extracted repos from citations
        for (const repoUrl of xData.resolvedUrls) {
          if (repoUrl.includes('github.com') && !extractedEntities.repos?.includes(repoUrl)) {
            const gh = await processGitHub(repoUrl)
            if (gh) {
              extractedEntities.repos?.push(repoUrl)
              if (!githubMetadata) {
                githubMetadata = gh
              }
            }
          }
        }
        // Store Grok citations in raw_data for reference
        // Summary from Grok will be used if classification doesn't provide one
      } else {
        // Fallback: oembed was used (limited access)

        // Handle X Articles (require login, can't extract content without Grok)
        if (xData.xArticleUrl) {
          const updates: Partial<Item> = {
            status: 'processed',
            processed_at: new Date().toISOString(),
            title: `@${xData.authorName} shared: X Article (login required)`,
            summary: `X Article shared by ${xData.authorName}. Content requires X login to view.`,
            transcript: `Resolved URL: ${xData.xArticleUrl}`,
            content_type: 'resource',
            extracted_entities: { repos: [], tools: [], techniques: [] },
            raw_data: { xData, xArticleUrl: xData.xArticleUrl },
            openai_cost: null,
            grok_cost: grokCost || null,
          }
          await supabase.from('items').update(updates).eq('id', itemId)
          return // Skip further processing
        }

        // Handle link-only tweets (just a URL with no commentary)
        if (xData.isLinkOnly && xData.resolvedUrls.length > 0) {
          transcript = `Shared link: ${xData.resolvedUrls[0]}`
        }

        // Check resolved URLs for GitHub repos (t.co links resolved)
        for (const resolvedUrl of xData.resolvedUrls) {
          if (resolvedUrl.includes('github.com')) {
            const gh = await processGitHub(resolvedUrl)
            if (gh) {
              extractedEntities.repos?.push(resolvedUrl)
              if (!githubMetadata) {
                githubMetadata = gh
              }
            }
          }
        }

        // Also check for GitHub URLs directly in the text
        const githubUrls = xData.text.match(/github\.com\/[^\s)]+/g) || []
        for (const ghUrl of githubUrls.slice(0, 3)) {
          const fullUrl = ghUrl.startsWith('http') ? ghUrl : `https://${ghUrl}`
          if (!extractedEntities.repos?.includes(fullUrl)) {
            const gh = await processGitHub(fullUrl)
            if (gh) {
              extractedEntities.repos?.push(fullUrl)
              if (!githubMetadata) {
                githubMetadata = gh
              }
            }
          }
        }
      }

      // Smart extraction pass: catch repos mentioned in transcript that weren't explicitly linked
      if (transcript && extractedEntities.repos?.length === 0) {
        console.log('No repos found via Grok/oembed, running smart extraction...')
        const existingUrls = extractedEntities.repos || []
        const smartRepos = await extractReposFromTranscript(transcript, existingUrls)
        for (const repo of smartRepos.slice(0, 3)) {
          if (!extractedEntities.repos?.includes(repo.url)) {
            const gh = await processGitHub(repo.url)
            if (gh) {
              extractedEntities.repos?.push(repo.url)
              if (!githubMetadata) {
                githubMetadata = gh
              }
            }
          }
        }
      }
    } else if (sourceType === 'article') {
      // Dynamic import to avoid JSDOM ESM issues on Vercel
      const { processArticle } = await import('./article')
      const articleData = await processArticle(item.source_url)
      if (articleData && articleData.content) {
        // Use article content as transcript for classification
        transcript = articleData.content
        // Check for GitHub URLs in article content
        const githubUrls = articleData.content.match(/github\.com\/[^\s)]+/g) || []
        for (const ghUrl of githubUrls.slice(0, 3)) {
          const fullUrl = ghUrl.startsWith('http') ? ghUrl : `https://${ghUrl}`
          if (!extractedEntities.repos?.includes(fullUrl)) {
            const gh = await processGitHub(fullUrl)
            if (gh) {
              extractedEntities.repos?.push(fullUrl)
              if (!githubMetadata) {
                githubMetadata = gh
              }
            }
          }
        }
      }
    }

    // Classify the content
    const classification = await classify({
      sourceType,
      transcript,
      githubMetadata: githubMetadata || undefined,
    })

    if (classification) {
      openaiCost = classification.cost
    }

    // Second pass: if no repos found but we have a title/summary, try again
    // This catches transcription errors like "Inc" -> "Ink"
    if (
      classification &&
      extractedEntities.repos?.length === 0 &&
      classification.title &&
      classification.summary
    ) {
      console.log('No repos found, running second pass with summary...')
      const summaryRepos = await extractReposFromSummary(
        classification.title,
        classification.summary,
        extractedEntities.repos || []
      )
      for (const repo of summaryRepos.slice(0, 3)) {
        const gh = await processGitHub(repo.url)
        if (gh) {
          extractedEntities.repos?.push(repo.url)
          if (!githubMetadata) {
            githubMetadata = gh
          }
          // Correct title if it was a transcription error
          // e.g., "Inc" -> "Ink" based on actual repo name
          if (
            classification.title.toLowerCase() !== gh.name.toLowerCase() &&
            classification.title.toLowerCase().replace(/[^a-z]/g, '') ===
            gh.name.toLowerCase().replace(/[^a-z]/g, '')
          ) {
            // Names are similar but different (likely transcription error)
            console.log(`Correcting title: "${classification.title}" -> "${gh.name}"`)
            classification.title = gh.name
          } else if (classification.title.length <= 10) {
            // Short title that's likely just the tool name - use repo name
            console.log(`Using repo name as title: "${gh.name}"`)
            classification.title = gh.name
          }
        }
      }
    }

    // Update the item with all extracted data
    const updates: Partial<Item> = {
      status: 'processed',
      processed_at: new Date().toISOString(),
      transcript: transcript || null,
      extracted_entities: extractedEntities,
      raw_data: {
        githubMetadata,
        transcript,
      },
      openai_cost: openaiCost || null,
      grok_cost: grokCost || null,
    }

    if (classification) {
      updates.title = classification.title
      updates.summary = classification.summary
      updates.domain = classification.domain
      updates.content_type = classification.content_type as Item['content_type']
      updates.tags = classification.tags
    }

    if (githubMetadata) {
      updates.github_url = item.source_url
      updates.github_metadata = {
        stars: githubMetadata.stars,
        language: githubMetadata.language || undefined,
        description: githubMetadata.description || undefined,
        topics: githubMetadata.topics,
      }
      // For GitHub repos, use the repo name as title if not set
      if (!updates.title) {
        updates.title = githubMetadata.name
      }
    }

    await supabase.from('items').update(updates).eq('id', itemId)

  } catch (error) {
    console.error('Processing error:', error)
    await supabase
      .from('items')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', itemId)
  }
}
