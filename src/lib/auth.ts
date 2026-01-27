import { NextRequest } from 'next/server'

// Get current user ID from request headers (set by middleware)
export function getCurrentUserId(request: NextRequest): string | null {
  return request.headers.get('x-user-id')
}

// Require authenticated user, throws if not present
export function requireUserId(request: NextRequest): string {
  const userId = getCurrentUserId(request)
  if (!userId) {
    throw new Error('User ID not found in request')
  }
  return userId
}
