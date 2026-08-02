import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function normalized(value: unknown): string {
  return String(value ?? '').trim()
}

function databaseNameFromUrl(value: string): string {
  try {
    const url = new URL(value)
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return ''
  }
}

function loopbackHost(value: string): boolean {
  const host = value.split(':')[0]?.trim().toLowerCase()
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)
}

export async function GET(request: NextRequest) {
  const enabled = normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_MODE).toLowerCase() === 'true'
  if (!enabled) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const host = normalized(request.headers.get('host'))
  if (!loopbackHost(host)) return NextResponse.json({ error: 'loopback_required' }, { status: 403 })

  const expectedNonce = normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_NONCE)
  const suppliedNonce = normalized(request.headers.get('x-radar-unified-release-production-nonce'))
  if (!expectedNonce || suppliedNonce !== expectedNonce) {
    return NextResponse.json({ error: 'invalid_production_nonce' }, { status: 403 })
  }

  const expectedDatabase = normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_DATABASE)
  const actualDatabase = databaseNameFromUrl(normalized(process.env.DATABASE_URL || process.env.DATABASE_URI))
  if (!expectedDatabase || actualDatabase !== expectedDatabase) {
    return NextResponse.json({ error: 'production_database_mismatch', expectedDatabase, actualDatabase }, { status: 409 })
  }

  const phase = normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_PHASE)
  if (!['plan', 'apply', 'verify'].includes(phase)) {
    return NextResponse.json({ error: 'invalid_production_phase' }, { status: 409 })
  }

  return NextResponse.json({
    schemaVersion: 'radar-unified-release-production-marker-0575-v01',
    productionMode: true,
    phase,
    database: actualDatabase,
    mainHead: normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_MAIN_HEAD),
    researchHead: normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_RESEARCH_HEAD),
    releaseId: normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_RELEASE_ID),
    candidateSha256: normalized(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_CANDIDATE_SHA256).toLowerCase(),
  })
}
