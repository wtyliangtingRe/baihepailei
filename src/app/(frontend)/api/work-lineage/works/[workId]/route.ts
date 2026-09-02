import { NextResponse } from 'next/server'

import { getPublicWorkById } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  try {
    const { workId } = await context.params
    const result = getPublicWorkById(workId)
    if (!result) {
      return NextResponse.json(
        { code: 'public_work_not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Public release exact read failed', error)
    return NextResponse.json(
      { code: 'public_release_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
