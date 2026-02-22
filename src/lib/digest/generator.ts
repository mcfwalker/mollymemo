// Script generator for daily voice digests
// Uses Claude to generate personalized, conversational scripts

import Anthropic from '@anthropic-ai/sdk'
import { MOLLY_SOUL } from './molly'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Claude Sonnet pricing per million tokens
const CLAUDE_SONNET_INPUT_COST = 3 / 1_000_000
const CLAUDE_SONNET_OUTPUT_COST = 15 / 1_000_000

function calculateAnthropicCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * CLAUDE_SONNET_INPUT_COST + outputTokens * CLAUDE_SONNET_OUTPUT_COST
}

export interface DigestItem {
  id: string
  title: string
  summary: string
  domain: string | null
  contentType: string | null
  tags: string[] | null
  sourceUrl: string
}

export interface MemoItem {
  id: string
  title: string
  summary: string
  relevanceReason: string
  sourcePlatform: string
  sourceUrl: string
}

export interface TrendItem {
  id: string
  trendType: string
  title: string
  description: string
  strength: number
}

export interface ContainerActivity {
  containerId: string
  containerName: string
  itemCountInWindow: number
  totalItemCount: number
  isNew: boolean // created within the digest window
}

export interface CrossReference {
  itemId: string
  itemTitle: string
  sourceUrl: string
  containerNames: string[]
}

export interface ProjectMatch {
  projectName: string
  projectDescription: string | null
  matchedItems: { itemId: string; itemTitle: string; matchedTags: string[] }[]
}

export interface DigestInput {
  user: {
    id: string
    displayName: string | null
    timezone: string
    mollyContext: string | null // Molly's evolving memory of this user
  }
  frequency: 'daily' | 'weekly'
  items: DigestItem[]
  memos: MemoItem[] // Molly's proactive discoveries
  trends: TrendItem[]
  containerActivity: ContainerActivity[]
  crossReferences: CrossReference[]
  projectMatches: ProjectMatch[]
  previousDigest: {
    id: string
    scriptText: string
    generatedAt: Date
    itemCount: number
  } | null
}

export async function generateScript(input: DigestInput): Promise<{ script: string; cost: number }> {
  const { user, items, memos, trends, previousDigest } = input
  const userName = user.displayName || 'there'

  // Build previous digest context
  let previousContext = 'No previous digest — this is their first one. Start fresh without referencing past digests.'
  if (previousDigest) {
    const daysAgo = Math.floor(
      (Date.now() - previousDigest.generatedAt.getTime()) / (1000 * 60 * 60 * 24)
    )
    const timeRef = daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
    previousContext = `Previous digest (${timeRef}, ${previousDigest.itemCount} items):
---
${previousDigest.scriptText.slice(0, 1500)}${previousDigest.scriptText.length > 1500 ? '...' : ''}
---
Reference this naturally if there's a thematic connection. Don't force it.`
  }

  // Group items by domain for structure hints
  const byDomain = items.reduce(
    (acc, item) => {
      const domain = item.domain || 'general'
      if (!acc[domain]) acc[domain] = []
      acc[domain].push(item)
      return acc
    },
    {} as Record<string, DigestItem[]>
  )

  const domainSummary = Object.entries(byDomain)
    .map(([domain, domainItems]) => `- ${domain}: ${domainItems.length} item(s)`)
    .join('\n')

  // Build items JSON for the prompt
  const itemsJson = JSON.stringify(
    items.map((item) => ({
      title: item.title,
      summary: item.summary,
      domain: item.domain,
      type: item.contentType,
      tags: item.tags,
    })),
    null,
    2
  )

  const systemPrompt = `You are Molly, a personal knowledge curator who delivers morning audio digests.

${MOLLY_SOUL}

## Task
Generate a spoken script (5-7 minutes when read aloud at 140 wpm = 700-1000 words).
The script will be converted to audio via text-to-speech, so:
- Write for the ear, not the eye
- No markdown, bullets, or formatting
- Spell out abbreviations on first use
- Don't read URLs — just reference by name

## Structure
1. Greeting (use their name: "${userName}")
2. Continuity hook (if previous digest exists and there's a natural connection)
3. Overview ("Today you've got X items across Y categories...")
4. Category blocks (group items, provide narrative transitions)
5. Closing (brief, genuine)

## What You Know About ${userName}
${user.mollyContext || 'This is a new user — you don\'t have context yet. Pay attention to patterns in what they save.'}

## Previous Digest Context
${previousContext}

## Today's Items (${items.length} total)
Domains breakdown:
${domainSummary}

Full items:
${itemsJson}

## Trends (${input.trends.length} detected)
${input.trends.length > 0 ? `These are patterns I've noticed in your saving behavior:
${JSON.stringify(input.trends.map(t => ({
  type: t.trendType,
  title: t.title,
  description: t.description,
})), null, 2)}

Mention these trends FIRST, before covering individual items. Lead with the most interesting trend.
Say something like "I've been noticing a pattern..." or "Something interesting about your saves lately..."
Keep each trend to 1-2 sentences.` : 'No trends detected right now.'}

## Molly's Discoveries (${memos.length} items)
${memos.length > 0 ? `I also found some things you might like based on your interests:
${JSON.stringify(memos.map(m => ({
  title: m.title,
  summary: m.summary,
  reason: m.relevanceReason,
  platform: m.sourcePlatform,
})), null, 2)}

Weave these into the digest naturally after covering the user's captures.
Say something like "I also found a few things you might like..." and briefly mention 2-3 of them.
Keep it brief — these are suggestions, not the main content.` : 'No discoveries this time — I haven\'t found anything new matching their interests.'}

Generate the script now. Output ONLY the script text, no preamble or meta-commentary.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: systemPrompt,
      },
    ],
  })

  // Calculate cost from usage
  const cost = calculateAnthropicCost(
    message.usage.input_tokens,
    message.usage.output_tokens
  )

  // Extract text from response
  const textBlock = message.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  return { script: textBlock.text, cost }
}

// Estimate audio duration based on word count
// Average speaking rate: ~140 words per minute
export function estimateDuration(script: string): number {
  const wordCount = script.split(/\s+/).length
  const minutes = wordCount / 140
  return Math.ceil(minutes * 60) // Return seconds
}

// Update Molly's context/memory about a user after a digest
export async function updateUserContext(
  currentContext: string | null,
  items: DigestItem[],
  userName: string
): Promise<{ context: string; cost: number }> {
  const itemsSummary = items
    .map((i) => `- ${i.title} (${i.domain || 'general'}, ${i.contentType || 'unknown'})`)
    .join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are maintaining a brief context profile for a user named ${userName}. This helps personalize their daily knowledge digests.

Current context:
${currentContext || '(none yet)'}

Items they just saved:
${itemsSummary}

Update the context profile. Keep it to 2-4 sentences max. Note:
- Recurring themes or interests
- Preferred content types (repos, tools, tutorials, etc.)
- Any patterns you notice

Output ONLY the updated context, nothing else.`,
      },
    ],
  })

  const cost = calculateAnthropicCost(
    message.usage.input_tokens,
    message.usage.output_tokens
  )

  const textBlock = message.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return { context: currentContext || '', cost }
  }

  return { context: textBlock.text, cost }
}
