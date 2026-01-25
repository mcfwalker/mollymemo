// Main processor that orchestrates extraction and classification

import { createServerClient, Item } from '../supabase'
import { detectSourceType, parseGitHubUrl } from './detect'
import { processGitHub } from './github'
import { processTikTok } from './tiktok'
import { classify } from './classifier'

export async function processItem(itemId: string): Promise<void> {
  const supabase = createServerClient()

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
    }
    // TODO: Add article processor

    // Classify the content
    const classification = await classify({
      sourceType,
      transcript,
      githubMetadata: githubMetadata || undefined,
    })

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
