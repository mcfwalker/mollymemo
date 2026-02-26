/**
 * Authentication API Route
 *
 * Handles Google OAuth authentication via Supabase Auth.
 *
 * POST /api/auth - Initiate Google OAuth sign-in
 * DELETE /api/auth - Logout (clear session)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

/**
 * Initiate Google OAuth sign-in via Supabase.
 * Returns the Google OAuth URL for the client to navigate to.
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin') || request.nextUrl.origin
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/api/auth/callback`,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })

    if (error || !data.url) {
      console.error('Google OAuth error:', error)
      return NextResponse.json({ error: 'Failed to initiate login' }, { status: 500 })
    }

    return NextResponse.json({ url: data.url })
  } catch {
    return NextResponse.json({ error: 'Failed to initiate login' }, { status: 500 })
  }
}

/**
 * Sign out the current user, clearing their session.
 *
 * @returns Success confirmation
 */
export async function DELETE() {
  // Logout - sign out from Supabase Auth
  const supabase = await createServerClient()
  await supabase.auth.signOut()

  const response = NextResponse.json({ success: true })
  // Clear any legacy cookies
  response.cookies.delete('mollymemo_auth')
  return response
}
