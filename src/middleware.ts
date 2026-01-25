import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/login', '/api/capture', '/api/auth']

// Base64url encode/decode for Edge Runtime
function base64urlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  return atob(padded)
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Verify session token using Web Crypto API (Edge Runtime compatible)
async function verifyToken(token: string): Promise<boolean> {
  if (!token || !token.includes('.')) return false

  const secret = process.env.SITE_PASSWORD_HASH || process.env.API_SECRET_KEY
  if (!secret) return false

  try {
    const [data, signature] = token.split('.')

    // Import key for HMAC
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    // Generate expected signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const expectedSig = base64urlEncode(signatureBuffer)

    if (signature !== expectedSig) return false

    // Check expiration
    const payload = JSON.parse(base64urlDecode(data))
    if (payload.exp < Date.now()) return false

    return true
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('lazylist_auth')
  const isValid = authCookie ? await verifyToken(authCookie.value) : false

  if (!isValid) {
    // For API routes, return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Redirect to login for UI routes
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Static assets (fonts, videos, images)
     */
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.mp4$|.*\\.webm$|.*\\.woff2?$|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
}
