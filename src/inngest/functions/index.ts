/**
 * Inngest function registry — DEPRECATED (SSV-275, 2026-04-29).
 *
 * MollyMemo is being decommissioned. Item processing has moved to Sidespace's
 * `process-item` Supabase edge function (SSV-272). The trend / discover /
 * report / merge crons that ran here are not being ported — Sidespace's
 * memory cognition pipeline (F#29) supersedes them.
 *
 * Empty function list → Inngest deregisters all scheduled crons on next deploy.
 * Source files retained for reference until the deployment is fully torn down
 * on 2026-05-29.
 */
export const functions = [];
