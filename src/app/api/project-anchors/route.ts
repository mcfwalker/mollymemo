/**
 * Project Anchors API
 *
 * Allows Sidespace (or other external services) to push project manifests
 * that MollyMemo uses as filing and relevance hints.
 *
 * POST /api/project-anchors - Upsert a project anchor
 * DELETE /api/project-anchors?external_project_id=<uuid> - Remove a project anchor
 * GET /api/project-anchors - List anchors for a user
 *
 * Auth: Service API key via Authorization header + user_id in body/query.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import logger from '@/lib/logger'

function validateServiceKey(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  return token === process.env.MOLLYMEMO_API_KEY
}

/**
 * Upsert a project anchor. If an anchor with the same (user_id, external_project_id)
 * exists, it gets updated. Otherwise a new one is created.
 */
export async function POST(request: NextRequest) {
  if (!validateServiceKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { user_id, external_project_id, name, description, tags, stage, source } = body

  if (!user_id || !external_project_id || !name) {
    return NextResponse.json(
      { error: 'Missing required fields: user_id, external_project_id, name' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('project_anchors')
    .upsert(
      {
        user_id,
        external_project_id,
        name,
        description: description || null,
        tags: tags || [],
        stage: stage || null,
        source: source || 'sidespace',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,external_project_id' }
    )
    .select()
    .single()

  if (error) {
    logger.error({ err: error }, 'Project anchor upsert error')
    return NextResponse.json({ error: 'Failed to upsert project anchor' }, { status: 500 })
  }

  return NextResponse.json({ anchor: data })
}

/**
 * Remove a project anchor (e.g., when a project is archived in Sidespace).
 */
export async function DELETE(request: NextRequest) {
  if (!validateServiceKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const userId = searchParams.get('user_id')
  const externalProjectId = searchParams.get('external_project_id')

  if (!userId || !externalProjectId) {
    return NextResponse.json(
      { error: 'Missing required params: user_id, external_project_id' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('project_anchors')
    .delete()
    .eq('user_id', userId)
    .eq('external_project_id', externalProjectId)

  if (error) {
    logger.error({ err: error }, 'Project anchor delete error')
    return NextResponse.json({ error: 'Failed to delete project anchor' }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}

/**
 * List project anchors for a user.
 */
export async function GET(request: NextRequest) {
  if (!validateServiceKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = request.nextUrl.searchParams.get('user_id')
  if (!userId) {
    return NextResponse.json({ error: 'Missing required param: user_id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('project_anchors')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    logger.error({ err: error }, 'Project anchors list error')
    return NextResponse.json({ error: 'Failed to list project anchors' }, { status: 500 })
  }

  return NextResponse.json({ anchors: data || [] })
}
