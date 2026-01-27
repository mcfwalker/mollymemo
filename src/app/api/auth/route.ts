import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, checkRateLimit, generateSessionToken } from '@/lib/security'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
  const rateLimit = checkRateLimit(`auth:${ip}`, 5, 15 * 60 * 1000) // 5 attempts per 15 min

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000))
        }
      }
    )
  }

  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    // Look up user by email
    const supabase = createServerClient()
    const { data: user, error } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Verify password hash
    if (!verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Generate secure session token with user ID and 30-day expiration
    const sessionToken = generateSessionToken(user.id, 30 * 24 * 60 * 60 * 1000)

    const response = NextResponse.json({ success: true })
    response.cookies.set('lazylist_auth', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

export async function DELETE() {
  // Logout - clear the cookie
  const response = NextResponse.json({ success: true })
  response.cookies.delete('lazylist_auth')
  return response
}
