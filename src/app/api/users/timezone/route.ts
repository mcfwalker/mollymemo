/**
 * Timezone Update API Route
 *
 * Updates the user's timezone setting. Validates against IANA timezone database.
 * This is a convenience endpoint; timezone can also be updated via /api/users/settings.
 *
 * POST /api/users/timezone - Update timezone
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import logger from '@/lib/logger'

/**
 * Update the user's timezone.
 *
 * @param request - JSON body with { timezone: string } (IANA timezone)
 * @returns Success confirmation or validation error
 */
export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { timezone } = await request.json()

  // Validate timezone is a valid IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('users')
    .update({ timezone })
    .eq('id', userId)

  if (error) {
    logger.error({ err: error }, 'Failed to update timezone')
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
