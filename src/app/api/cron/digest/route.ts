/**
 * Cron Digest API Route
 *
 * Scheduled endpoint for generating and sending daily voice digests.
 * Runs hourly via Vercel Cron, checks which users need their digest
 * based on their preferred time and timezone.
 *
 * GET /api/cron/digest - Process digests (protected by CRON_SECRET)
 *
 * Query Parameters (development only):
 * - test=true: Bypass CRON_SECRET check (disabled in production)
 * - user_id: Send digest to specific user
 *
 * Flow:
 * 1. Find users whose digest_time matches current hour in their timezone
 * 2. For each user, fetch items captured in last 24 hours
 * 3. Generate personalized voice script via Claude
 * 4. Convert to audio via OpenAI TTS
 * 5. Send via Telegram voice message
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  generateAndSendDigest,
  getUsersForDigestNow,
  DigestUser,
} from '@/lib/digest'
import logger from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max for processing multiple users

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const isTest = searchParams.get('test') === 'true'
  const testUserId = searchParams.get('user_id')

  // Verify authorization — always require CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Test mode: send digest to a specific user immediately
    if (isTest && testUserId) {
      const supabase = createServiceClient()
      const { data: user, error } = await supabase
        .from('users')
        .select(
          'id, display_name, telegram_user_id, digest_frequency, digest_day, digest_time, timezone, molly_context'
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

      const testFrequency = (user.digest_frequency === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly'
      await generateAndSendDigest(user as unknown as DigestUser, testFrequency)

      return NextResponse.json({
        ok: true,
        message: `Test digest sent to ${user.display_name || user.id}`,
      })
    }

    // Production mode: find users whose digest time is now
    const usersToProcess = await getUsersForDigestNow()

    logger.info({ userCount: usersToProcess.length }, 'Found users for digest at this hour')

    const results: Array<{ userId: string; success: boolean; error?: string }> =
      []

    for (const { user, frequency } of usersToProcess) {
      try {
        await generateAndSendDigest(user, frequency)
        results.push({ userId: user.id, success: true })
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'Failed to generate digest for user')
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
      processed: usersToProcess.length,
      success: successCount,
      failed: failCount,
      results,
    })
  } catch (error) {
    logger.error({ err: error }, 'Digest cron error')
    return NextResponse.json(
      { error: 'Internal error', details: String(error) },
      { status: 500 }
    )
  }
}
