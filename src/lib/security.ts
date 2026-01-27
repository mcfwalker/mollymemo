import { timingSafeEqual, randomBytes, createHmac, scryptSync } from 'crypto'

// Timing-safe string comparison to prevent timing attacks
export function secureCompare(a: string, b: string): boolean {
  if (!a || !b) return false

  // Pad to same length to prevent length-based timing leaks
  const maxLen = Math.max(a.length, b.length)
  const aPadded = a.padEnd(maxLen, '\0')
  const bPadded = b.padEnd(maxLen, '\0')

  try {
    return timingSafeEqual(Buffer.from(aPadded), Buffer.from(bPadded))
  } catch {
    return false
  }
}

// Hash password using scrypt
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

// Verify password against stored hash
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(':')
    if (!salt || !hash) return false
    const derivedHash = scryptSync(password, salt, 64).toString('hex')
    return secureCompare(derivedHash, hash)
  } catch {
    return false
  }
}

// In-memory rate limiter for serverless environments
// Trade-off: Resets on cold starts, but acceptable for this use case because:
// - Cold starts are infrequent with regular traffic
// - Only protects login (password is the primary defense)
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

// Generate secure session token with HMAC signature
export function generateSessionToken(userId: string, expiresInMs: number = 30 * 24 * 60 * 60 * 1000): string {
  const secret = process.env.SITE_PASSWORD_HASH || process.env.API_SECRET_KEY
  if (!secret) throw new Error('No secret configured')

  const payload = {
    id: randomBytes(16).toString('hex'),
    userId,
    exp: Date.now() + expiresInMs
  }

  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(data).digest('base64url')

  return `${data}.${signature}`
}

// Verify session token (Node.js crypto version - used in tests)
// Note: middleware.ts has an equivalent Web Crypto API version for Edge Runtime
export function verifySessionToken(token: string): boolean {
  if (!token || !token.includes('.')) return false

  const secret = process.env.SITE_PASSWORD_HASH || process.env.API_SECRET_KEY
  if (!secret) return false

  try {
    const [data, signature] = token.split('.')

    // Verify signature
    const expectedSig = createHmac('sha256', secret).update(data).digest('base64url')
    if (!secureCompare(signature, expectedSig)) return false

    // Check expiration
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (payload.exp < Date.now()) return false

    return true
  } catch {
    return false
  }
}

// Extract user ID from session token (Node.js crypto version)
export function getUserIdFromToken(token: string): string | null {
  if (!token || !token.includes('.')) return null

  const secret = process.env.SITE_PASSWORD_HASH || process.env.API_SECRET_KEY
  if (!secret) return null

  try {
    const [data, signature] = token.split('.')

    // Verify signature first
    const expectedSig = createHmac('sha256', secret).update(data).digest('base64url')
    if (!secureCompare(signature, expectedSig)) return null

    // Check expiration and extract userId
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (payload.exp < Date.now()) return null

    return payload.userId || null
  } catch {
    return null
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
