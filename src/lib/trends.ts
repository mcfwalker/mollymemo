// Trend detection engine — algorithmic detectors + LLM narration

// --- Types ---

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
  supabase: any,
  userId: string
): Promise<VelocitySignal[]> {
  const { data: containers, error: cErr } = await supabase
    .from('containers')
    .select('id, name')
    .eq('user_id', userId)

  if (cErr || !containers || containers.length === 0) return []

  const cutoff = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const containerIds = containers.map((c: any) => c.id)

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
  supabase: any,
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

  return data.map((row: any) => ({
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
  supabase: any,
  userId: string
): Promise<ConvergenceSignal[]> {
  const { data: containers, error: cErr } = await supabase
    .from('containers')
    .select('id, name')
    .eq('user_id', userId)

  if (cErr || !containers || containers.length < 2) return []

  const containerMap = new Map<string, string>()
  for (const c of containers) {
    containerMap.set(c.id, c.name)
  }

  const cutoff = new Date(Date.now() - CONVERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase.rpc('detect_container_convergence', {
    p_user_id: userId,
    p_cutoff: cutoff,
    p_threshold: CONVERGENCE_THRESHOLD,
  })

  if (error || !data) return []

  return data
    .filter((row: any) => containerMap.has(row.container_a) && containerMap.has(row.container_b))
    .map((row: any) => ({
      type: 'convergence' as const,
      containerA: { id: row.container_a, name: containerMap.get(row.container_a)! },
      containerB: { id: row.container_b, name: containerMap.get(row.container_b)! },
      sharedItems: row.shared_count,
    }))
}

// --- LLM Narration ---

const OPENAI_INPUT_PRICE = 0.15 / 1_000_000
const OPENAI_OUTPUT_PRICE = 0.60 / 1_000_000

export async function narrateTrends(
  signals: TrendSignal[]
): Promise<NarrationResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`OpenAI API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content

    if (!text) {
      console.error('No response from OpenAI for trend narration')
      return null
    }

    const usage = data.usage || {}
    const cost = (usage.prompt_tokens || 0) * OPENAI_INPUT_PRICE +
                 (usage.completion_tokens || 0) * OPENAI_OUTPUT_PRICE

    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    const trends: NarratedTrend[] = (parsed.trends || []).map((t: any, i: number) => ({
      trendType: t.trendType,
      title: t.title,
      description: t.description,
      strength: Math.min(1.0, Math.max(0.0, t.strength || 0.5)),
      signals: signals[i] || signals[0],
    }))

    return { trends, cost }
  } catch (error) {
    console.error('Trend narration error:', error)
    return null
  }
}
