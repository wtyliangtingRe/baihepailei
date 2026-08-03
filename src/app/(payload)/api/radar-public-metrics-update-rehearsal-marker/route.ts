import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const clean = (value: unknown) => String(value ?? '').trim()

export async function GET(request: Request) {
  const nonce = clean(
    process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_NONCE,
  )
  const supplied = clean(
    request.headers.get(
      'x-radar-public-metrics-update-rehearsal-nonce',
    ),
  )

  if (!nonce || !supplied || supplied !== nonce) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const phase = clean(
    process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_PHASE,
  )
  if (!['plan', 'apply', 'verify'].includes(phase)) {
    return NextResponse.json(
      { error: 'invalid_rehearsal_phase' },
      { status: 503 },
    )
  }

  return NextResponse.json(
    {
      schemaVersion:
        'radar-public-metrics-update-rehearsal-marker-v01',
      rehearsalMode: true,
      productionAuthorization: false,
      phase,
      database: clean(
        process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_DATABASE,
      ),
      toolHead: clean(
        process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_TOOL_HEAD,
      ),
      researchHead: clean(
        process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RESEARCH_HEAD,
      ),
      releaseId: clean(
        process.env.RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RELEASE_ID,
      ),
      candidateSha256: clean(
        process.env
          .RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_CANDIDATE_SHA256,
      ),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}