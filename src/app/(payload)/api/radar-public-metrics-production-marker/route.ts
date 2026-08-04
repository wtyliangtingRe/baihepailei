import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const clean = (value: unknown) => String(value ?? '').trim()

export async function GET(request: Request) {
  if (clean(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_MODE) !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const nonce = clean(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_NONCE)
  const supplied = clean(
    request.headers.get('x-radar-public-metrics-production-nonce'),
  )

  if (!nonce || !supplied || supplied !== nonce) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const phase = clean(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_PHASE)
  const executionMode = clean(
    process.env.RADAR_PUBLIC_METRICS_PRODUCTION_EXECUTION_MODE,
  )
  const productionAuthorization =
    clean(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION) ===
    'true'

  if (!['plan', 'apply', 'verify'].includes(phase)) {
    return NextResponse.json(
      { error: 'invalid_production_phase' },
      { status: 503 },
    )
  }

  if (!['rehearsal', 'production'].includes(executionMode)) {
    return NextResponse.json(
      { error: 'invalid_execution_mode' },
      { status: 503 },
    )
  }

  if (
    (executionMode === 'rehearsal' && productionAuthorization) ||
    (executionMode === 'production' && !productionAuthorization)
  ) {
    return NextResponse.json(
      { error: 'authorization_mode_mismatch' },
      { status: 503 },
    )
  }

  return NextResponse.json(
    {
      schemaVersion: 'radar-public-metrics-production-marker-v01',
      productionMode: true,
      executionMode,
      productionAuthorization,
      phase,
      database: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_DATABASE,
      ),
      toolHead: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_TOOL_HEAD,
      ),
      researchHead: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_RESEARCH_HEAD,
      ),
      releaseId: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_RELEASE_ID,
      ),
      candidateSha256: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_CANDIDATE_SHA256,
      ),
      sourceContainerId: clean(
        process.env.RADAR_PUBLIC_METRICS_PRODUCTION_SOURCE_CONTAINER_ID,
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
