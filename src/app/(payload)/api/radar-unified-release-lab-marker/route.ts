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

export async function GET(request: NextRequest) {
  const enabled = normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_MODE).toLowerCase() === 'true'
  if (!enabled) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const expectedNonce = normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_NONCE)
  const suppliedNonce = normalized(request.headers.get('x-radar-unified-release-lab-nonce'))
  if (!expectedNonce || suppliedNonce !== expectedNonce) {
    return NextResponse.json({ error: 'invalid_lab_nonce' }, { status: 403 })
  }

  const expectedDatabase = normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_DATABASE)
  const actualDatabase = databaseNameFromUrl(normalized(process.env.DATABASE_URL || process.env.DATABASE_URI))
  if (!expectedDatabase || actualDatabase !== expectedDatabase) {
    return NextResponse.json({ error: 'lab_database_mismatch', expectedDatabase, actualDatabase }, { status: 409 })
  }

  return NextResponse.json({
    schemaVersion: 'radar-unified-release-lab-marker-0575-v01',
    isolatedLab: true,
    database: actualDatabase,
    websiteCommit: normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_WEBSITE_COMMIT),
    researchHead: normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_RESEARCH_HEAD),
    releaseId: normalized(process.env.RADAR_UNIFIED_RELEASE_LAB_RELEASE_ID),
  })
}
