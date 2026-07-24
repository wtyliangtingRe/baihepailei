import config from '@payload-config'
import { getPayload } from 'payload'
import { NextResponse, type NextRequest } from 'next/server'

export const RADAR_READONLY_AUDIT_EMAIL = 'radar-readonly-audit@localhost.invalid'

type RadarReadonlyCollection = 'works' | 'radar-public-conclusions'

function expectedToken() {
  return String(process.env.RADAR_READONLY_AUDIT_TOKEN || '').trim()
}

function safeInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function isRadarReadonlyBearer(request: NextRequest) {
  const token = expectedToken()
  if (!token) return false
  return request.headers.get('authorization') === `JWT ${token}`
}

export async function isRadarReadonlyLogin(request: NextRequest) {
  const token = expectedToken()
  if (!token) return false
  const body = await request.clone().json().catch(() => null) as null | {
    email?: unknown
    password?: unknown
  }
  return String(body?.email || '').trim() === RADAR_READONLY_AUDIT_EMAIL
    && String(body?.password || '') === token
}

export function radarReadonlyLoginResponse() {
  const token = expectedToken()
  if (!token) {
    return NextResponse.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })
  }
  return NextResponse.json({
    token,
    user: {
      id: 'radar-readonly-audit',
      email: RADAR_READONLY_AUDIT_EMAIL,
      role: 'owner',
    },
  })
}

export async function radarReadonlyFind(
  request: NextRequest,
  collection: RadarReadonlyCollection,
) {
  const url = new URL(request.url)
  const page = safeInteger(url.searchParams.get('page'), 1, 1, 1_000_000)
  const limit = safeInteger(url.searchParams.get('limit'), 200, 1, 200)
  const draftValue = url.searchParams.get('draft')
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection,
    page,
    limit,
    depth: 0,
    pagination: true,
    overrideAccess: true,
    ...(collection === 'works' && draftValue !== null
      ? { draft: draftValue === 'true' }
      : {}),
  })

  return NextResponse.json(result)
}
