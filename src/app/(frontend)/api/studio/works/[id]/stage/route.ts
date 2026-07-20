import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

import { syncWorkToPublicIndexes } from '@/lib/publicIndexSync'

type Params = { params: Promise<{ id: string }> }
type WorkStage = 'temporary' | 'formal'

type WorkDoc = {
  id: string | number
  catalogStatus?: string
  _status?: string
}

function responseError(message: string, status: number) {
  return NextResponse.json({ errors: [{ message }], message }, { status })
}

function normalizedOrigin(value: string | null) {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function requestOrigin(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(/:$/u, '')
  return host ? `${protocol}://${host}` : request.nextUrl.origin
}

function isSameOrigin(request: NextRequest) {
  const supplied = normalizedOrigin(request.headers.get('origin'))
  const expected = normalizedOrigin(requestOrigin(request))
  return Boolean(supplied && expected && supplied === expected)
}

function stageValue(value: unknown): WorkStage | null {
  return value === 'temporary' || value === 'formal' ? value : null
}

export async function GET(request: NextRequest, { params }: Params) {
  const payload = await getPayload({ config })
  const auth = await payload.auth({ headers: request.headers })
  if (!auth.user || !isEditor(auth.user)) return responseError('没有作品编辑权限。', 403)

  const { id } = await params
  try {
    const work = await payload.findByID({ collection: 'works', id, depth: 0, overrideAccess: true }) as WorkDoc
    return NextResponse.json({ stage: work.catalogStatus === 'temporary' ? 'temporary' : 'formal' })
  } catch {
    return responseError('没有找到目标作品。', 404)
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) return responseError('请求来源不受信任，请从站内作品编辑页重试。', 403)

  const payload = await getPayload({ config })
  const auth = await payload.auth({ headers: request.headers })
  if (!auth.user || !isEditor(auth.user)) return responseError('没有作品编辑权限。', 403)

  let input: Record<string, unknown>
  try {
    input = await request.json() as Record<string, unknown>
  } catch {
    return responseError('请求内容不是有效的 JSON。', 400)
  }

  const stage = stageValue(input.stage)
  if (!stage) return responseError('作品阶段无效。', 400)

  const { id } = await params
  try {
    const updated = await payload.update({
      collection: 'works',
      id,
      depth: 1,
      draft: false,
      overrideAccess: true,
      user: auth.user,
      context: {
        firstPartyStudio: true,
        lifecycleStageUpdate: true,
        auditActorID: (auth.user as { id?: string | number }).id,
      },
      data: {
        catalogStatus: stage === 'temporary' ? 'temporary' : 'active',
        _status: 'published',
        isLiteVisible: true,
        isFullVisible: true,
      },
    }) as WorkDoc

    try {
      syncWorkToPublicIndexes(updated)
    } catch (error) {
      console.error('Work stage updated but public index sync failed', { id, stage, error })
    }

    return NextResponse.json({ doc: updated, stage })
  } catch (caught) {
    const error = caught as { message?: string; status?: number }
    return responseError(error.message || '作品阶段更新失败。', error.status || 500)
  }
}
