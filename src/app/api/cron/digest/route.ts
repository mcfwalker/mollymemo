// Cron endpoint for daily voice digest
// Runs hourly, checks which users need their digest based on timezone

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  generateAndSendDigest,
  getUsersForDigestNow,
  DigestUser,
} from '@/lib/digest'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max for processing multiple users

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const isTest = searchParams.get('test') === 'true'
  const testUserId = searchParams.get('user_id')

  // Verify authorization
  // In production, Vercel cron sends Authorization header
  // For test mode, we skip this check
  if (!isTest) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // Test mode: send digest to a specific user immediately
    if (isTest && testUserId) {
      const supabase = createServiceClient()
      const { data: user, error } = await supabase
        .from('users')
        .select(
          'id, display_name, telegram_user_id, digest_enabled, digest_time, timezone'
        )
        .eq('id', testUserId)
        .single()

      if (error || !user) {
        return NextResponse.json(
          { error: 'User not found', details: error },
          { status: 404 }
        )
      }

      if (!user.telegram_user_id) {
        return NextResponse.json(
          { error: 'User has no telegram_user_id' },
          { status: 400 }
        )
      }

      await generateAndSendDigest(user as DigestUser)

      return NextResponse.json({
        ok: true,
        message: `Test digest sent to ${user.display_name || user.id}`,
      })
    }

    // Production mode: find users whose digest time is now
    const users = await getUsersForDigestNow()

    console.log(`Found ${users.length} users for digest at this hour`)

    const results: Array<{ userId: string; success: boolean; error?: string }> =
      []

    // Process each user
    for (const user of users) {
      try {
        await generateAndSendDigest(user)
        results.push({ userId: user.id, success: true })
      } catch (error) {
        console.error(`Failed to generate digest for user ${user.id}:`, error)
        results.push({
          userId: user.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      ok: true,
      processed: users.length,
      success: successCount,
      failed: failCount,
      results,
    })
  } catch (error) {
    console.error('Digest cron error:', error)
    return NextResponse.json(
      { error: 'Internal error', details: String(error) },
      { status: 500 }
    )
  }
}
