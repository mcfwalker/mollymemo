/**
 * Telegram Bot Webhook API Route — DEPRECATED
 *
 * As of SSV-272 (2026-04-29), Telegram capture is handled by Sidespace's
 * `capture-item` Supabase edge function. The bot's webhook URL was repointed
 * directly. This route remains as a 30-day grace-window 307 redirect for any
 * in-flight callers (legacy scripts, accidental hard-coded URLs).
 *
 * To be deleted on 2026-05-29 along with the rest of the MollyMemo Vercel
 * deployment (SSV-275).
 */
import { NextResponse } from 'next/server'

const CAPTURE_ITEM_URL =
  'https://xvblgybgihzbknwrjdit.supabase.co/functions/v1/capture-item'

export async function POST() {
  return NextResponse.redirect(CAPTURE_ITEM_URL, 307)
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      message:
        'This endpoint has moved. Telegram capture now flows through Sidespace.',
      new_endpoint: CAPTURE_ITEM_URL,
      retired: '2026-05-29',
    },
    { status: 410 }
  )
}
