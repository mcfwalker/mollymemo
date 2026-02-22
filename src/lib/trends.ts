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
