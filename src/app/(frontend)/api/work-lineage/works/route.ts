import { type NextRequest, NextResponse } from 'next/server'

import { getPublicWorkList } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

function integer(value: string | null): number | undefined {
  if (value === null || !/^[0-9]+$/.test(value)) return undefined
  return Number(value)
}

export async function GET(request: NextRequest) {
  try {
    const result = getPublicWorkList({
      query: request.nextUrl.searchParams.get('q') || '',
      grade: request.nextUrl.searchParams.get('grade') || '',
      status: request.nextUrl.searchParams.get('status') || '',
      media: request.nextUrl.searchParams.get('media') || '',
      limit: integer(request.nextUrl.searchParams.get('limit')),
      offset: integer(request.nextUrl.searchParams.get('offset')),
    })
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Public release list read failed', error)
    return NextResponse.json(
      { code: 'public_release_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
