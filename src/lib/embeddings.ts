// Embedding service using OpenAI text-embedding-3-small

import logger from '@/lib/logger'

// Pricing: $0.02 per 1M tokens
const EMBEDDING_PRICE_PER_MILLION = 0.02

export interface EmbeddingResult {
  embedding: number[]
  cost: number
}

export interface EmbeddingInput {
  title: string | null
  summary: string | null
  tags: string[] | null
}

/**
 * Build text for embedding from item fields
 */
export function buildEmbeddingText(input: EmbeddingInput): string {
  const parts: string[] = []

  if (input.title) {
    parts.push(input.title)
  }

  if (input.summary) {
    parts.push(input.summary)
  }

  if (input.tags && input.tags.length > 0) {
    parts.push(`Tags: ${input.tags.join(', ')}`)
  }

  return parts.join('\n\n')
}

/**
 * Generate embedding vector for text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logger.error('OPENAI_API_KEY not configured')
    return null
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error({ status: response.status, error }, 'OpenAI Embeddings API error')
      return null
    }

    const data = await response.json()
    const embedding = data.data?.[0]?.embedding

    if (!embedding) {
      logger.error('No embedding returned from OpenAI')
      return null
    }

    // Calculate cost
    const tokens = data.usage?.total_tokens || 0
    const cost = (tokens * EMBEDDING_PRICE_PER_MILLION) / 1_000_000

    return { embedding, cost }
  } catch (error) {
    logger.error({ err: error }, 'Embedding generation error')
    return null
  }
}

/**
 * Generate embedding for an item
 */
export async function embedItem(input: EmbeddingInput): Promise<EmbeddingResult | null> {
  const text = buildEmbeddingText(input)
  if (!text) {
    return null
  }
  return generateEmbedding(text)
}
