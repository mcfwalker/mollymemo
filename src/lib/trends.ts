// Trend detection engine — algorithmic detectors + LLM narration

import type { SupabaseClient } from '@supabase/supabase-js'
import logger from '@/lib/logger'

// --- Types ---

interface ContainerRow {
  id: string
  name: string
}

interface ContainerItemRow {
  container_id: string
}

interface UserInterestRow {
  interest_type: string
  value: string
  occurrence_count: number
  first_seen: string
}

interface ConvergenceRow {
  container_a: string
  container_b: string
  shared_count: number
}

interface RawNarratedTrend {
  trendType: string
  title: string
  description: string
  strength: number
}

export interface VelocitySignal {
  type: 'velocity'
  containerId: string
  containerName: string
  itemCount14d: number
}

export interface EmergenceSignal {
  type: 'emergence'
  interestType: string
  value: string
  occurrenceCount: number
  firstSeen: string
}

export interface ConvergenceSignal {
  type: 'convergence'
  containerA: { id: string; name: string }
  containerB: { id: string; name: string }
  sharedItems: number
}

export type TrendSignal = VelocitySignal | EmergenceSignal | ConvergenceSignal

export interface NarratedTrend {
  trendType: string
  title: string
  description: string
  strength: number
  signals: object
}

export interface NarrationResult {
  trends: NarratedTrend[]
  cost: number
}

// --- Velocity Detection ---

const VELOCITY_THRESHOLD = 3
const VELOCITY_WINDOW_DAYS = 14

export async function detectVelocity(
  supabase: SupabaseClient,
  userId: string
): Promise<VelocitySignal[]> {
  const { data: containers, error: cErr } = await supabase
    .from('containers')
    .select('id, name')
    .eq('user_id', userId)

  if (cErr || !containers || containers.length === 0) return []

  const cutoff = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const containerIds = (containers as ContainerRow[]).map((c) => c.id)

  const { data: recentItems, error: iErr } = await supabase
    .from('container_items')
    .select('container_id, items!inner(captured_at)')
    .in('container_id', containerIds)
    .gte('items.captured_at', cutoff)

  if (iErr || !recentItems) return []

  const countByContainer = new Map<string, number>()
  for (const row of recentItems) {
    const count = countByContainer.get(row.container_id) || 0
    countByContainer.set(row.container_id, count + 1)
  }

  const signals: VelocitySignal[] = []
  for (const container of containers) {
    const count = countByContainer.get(container.id) || 0
    if (count >= VELOCITY_THRESHOLD) {
      signals.push({
        type: 'velocity',
        containerId: container.id,
        containerName: container.name,
        itemCount14d: count,
      })
    }
  }

  return signals
}

// --- Emergence Detection ---

const EMERGENCE_THRESHOLD = 2
const EMERGENCE_WINDOW_DAYS = 14

export async function detectEmergence(
  supabase: SupabaseClient,
  userId: string
): Promise<EmergenceSignal[]> {
  const cutoff = new Date(Date.now() - EMERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('user_interests')
    .select('interest_type, value, occurrence_count, first_seen')
    .eq('user_id', userId)
    .gte('first_seen', cutoff)
    .gte('occurrence_count', EMERGENCE_THRESHOLD)

  if (error || !data) return []

  return (data as UserInterestRow[]).map((row) => ({
    type: 'emergence' as const,
    interestType: row.interest_type,
    value: row.value,
    occurrenceCount: row.occurrence_count,
    firstSeen: row.first_seen,
  }))
}

// --- Convergence Detection ---

const CONVERGENCE_THRESHOLD = 2
const CONVERGENCE_WINDOW_DAYS = 30

export async function detectConvergence(
  supabase: SupabaseClient,
  userId: string
): Promise<ConvergenceSignal[]> {
  const { data: containers, error: cErr } = await supabase
    .from('containers')
    .select('id, name')
    .eq('user_id', userId)

  if (cErr || !containers || containers.length < 2) return []

  const containerMap = new Map<string, string>()
  for (const c of containers as ContainerRow[]) {
    containerMap.set(c.id, c.name)
  }

  const cutoff = new Date(Date.now() - CONVERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase.rpc('detect_container_convergence', {
    p_user_id: userId,
    p_cutoff: cutoff,
    p_threshold: CONVERGENCE_THRESHOLD,
  })

  if (error || !data) return []

  return (data as ConvergenceRow[])
    .filter((row) => containerMap.has(row.container_a) && containerMap.has(row.container_b))
    .map((row) => ({
      type: 'convergence' as const,
      containerA: { id: row.container_a, name: containerMap.get(row.container_a)! },
      containerB: { id: row.container_b, name: containerMap.get(row.container_b)! },
      sharedItems: row.shared_count,
    }))
}

// --- LLM Narration ---

import { chatCompletion, parseJsonResponse } from '@/lib/openai-client'

export async function narrateTrends(
  signals: TrendSignal[]
): Promise<NarrationResult | null> {
  const signalDescriptions = signals.map((s) => {
    switch (s.type) {
      case 'velocity':
        return `VELOCITY: Container "${s.containerName}" gained ${s.itemCount14d} items in the last 14 days.`
      case 'emergence':
        return `EMERGENCE: Interest "${s.value}" (${s.interestType}) appeared recently (first seen: ${s.firstSeen}) and already has ${s.occurrenceCount} occurrences.`
      case 'convergence':
        return `CONVERGENCE: Containers "${s.containerA.name}" and "${s.containerB.name}" share ${s.sharedItems} recent items.`
    }
  })

  const prompt = `You are a personal knowledge analyst. Given these detected signals about a user's saving patterns, generate concise, natural-language trend descriptions.

SIGNALS:
${signalDescriptions.join('\n')}

For each signal, generate:
- trendType: the signal type ("velocity", "emergence", or "convergence")
- title: 3-6 word phrase (e.g., "Deep into agent orchestration")
- description: one conversational sentence addressed to the user with "you" (e.g., "You've saved 5 items about agent orchestration in the last two weeks.")
- strength: 0.0-1.0 based on signal intensity (higher count/more overlap = stronger)

Return ONLY valid JSON, no markdown:
{"trends": [{"trendType": "...", "title": "...", "description": "...", "strength": 0.8}]}`

  try {
    const completion = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3 }
    )
    if (!completion) return null

    const { cost } = completion
    const parsed = parseJsonResponse(completion.text) as Record<string, unknown[]>

    const trends: NarratedTrend[] = ((parsed.trends || []) as RawNarratedTrend[]).map((t, i) => ({
      trendType: t.trendType,
      title: t.title,
      description: t.description,
      strength: Math.min(1.0, Math.max(0.0, t.strength || 0.5)),
      signals: signals[i] || signals[0],
    }))

    return { trends, cost }
  } catch (error) {
    logger.error({ err: error }, 'Trend narration error')
    return null
  }
}
