// Shared OpenAI chat completion client
// Consolidates fetch, error handling, cost calculation, and JSON parsing

import logger from '@/lib/logger'

// GPT-4o-mini pricing (per token)
const GPT4O_MINI_INPUT_COST = 0.15 / 1_000_000
const GPT4O_MINI_OUTPUT_COST = 0.60 / 1_000_000

export interface ChatCompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface ChatCompletionResult {
  text: string
  cost: number
}

export function calculateCost(usage: { prompt_tokens?: number; completion_tokens?: number }): number {
  return (usage.prompt_tokens || 0) * GPT4O_MINI_INPUT_COST +
         (usage.completion_tokens || 0) * GPT4O_MINI_OUTPUT_COST
}

export function parseJsonResponse(text: string): unknown {
  return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
}

export async function chatCompletion(
  messages: { role: string; content: string }[],
  options?: ChatCompletionOptions
): Promise<ChatCompletionResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logger.error('OPENAI_API_KEY not configured')
    return null
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options?.model ?? 'gpt-4o-mini',
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 500,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error({ status: response.status, error }, 'OpenAI API error')
    return null
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content

  if (!text) {
    logger.error('No response from OpenAI')
    return null
  }

  return { text, cost: calculateCost(data.usage || {}) }
}
