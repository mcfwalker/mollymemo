// In-memory rate limiter for serverless environments
// Trade-off: Resets on cold starts, but acceptable for this use case because:
// - Cold starts are infrequent with regular traffic
// - Only protects login
// - Upgrading to Redis/Upstash adds cost and complexity
// For high-security needs, use Upstash Redis: https://upstash.com/docs/redis/sdks/ratelimit-ts
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number
}

export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): RateLimitResult {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  // Clean up old entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetTime < now) rateLimitStore.delete(k)
    }
  }

  if (!record || record.resetTime < now) {
    // First attempt or window expired
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1, resetIn: windowMs }
  }

  if (record.count >= maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: record.resetTime - now
    }
  }

  record.count++
  return {
    allowed: true,
    remaining: maxAttempts - record.count,
    resetIn: record.resetTime - now
  }
}

// Sanitize search input to prevent SQL injection in PostgREST filters
export function sanitizeSearchInput(input: string): string {
  // Escape PostgREST special characters: %, _, \
  // Also limit length and remove potentially dangerous characters
  return input
    .slice(0, 100) // Limit length
    .replace(/[%_\\]/g, '\\$&') // Escape PostgREST wildcards
    .replace(/[^\w\s\-.']/g, '') // Only allow safe characters
}
