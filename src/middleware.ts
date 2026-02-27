import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/login', '/api/auth', '/api/auth/callback', '/api/telegram', '/api/cron', '/api/inngest', '/api/capture']

// Routes that require admin access
const ADMIN_ROUTES = ['/admin', '/api/admin']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Create response that we can modify (for cookie updates)
  let response = NextResponse.next({
    request,
  })

  // Create Supabase client with cookie handlers
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Update request cookies (for downstream handlers)
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          // Create new response with updated request
          response = NextResponse.next({
            request,
          })
          // Set cookies on response (for browser)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Verify session with Supabase Auth
  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user || error) {
    // For API routes, return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Redirect to login for UI routes
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Check admin access for admin routes
  const isAdminRoute = ADMIN_ROUTES.some(route => pathname.startsWith(route))
  if (isAdminRoute) {
    // Use service client to check is_admin (bypasses RLS)
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: userData } = await serviceClient
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      // For API routes, return 403
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // For UI routes, redirect to home
      const homeUrl = new URL('/', request.url)
      return NextResponse.redirect(homeUrl)
    }
  }

  // Pass user ID to routes via request header
  response.headers.set('x-user-id', user.id)

  return response
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
