import { type NextRequest, NextResponse } from 'next/server'

import { getRecommendationBatch } from '../../recommendations/get-batch'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const sOffset = Number(params.get('sOffset') ?? 0)
  const aOffset = Number(params.get('aOffset') ?? 0)

  if (!Number.isSafeInteger(sOffset) || sOffset < 0 || !Number.isSafeInteger(aOffset) || aOffset < 0) {
    return NextResponse.json({ code: 'invalid_recommendation_offset' }, { status: 400 })
  }

  return NextResponse.json(getRecommendationBatch({ sOffset, aOffset }), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
