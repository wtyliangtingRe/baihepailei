import { type NextRequest, NextResponse } from 'next/server'

import { getFormalWorkLineageList } from '@/lib/work-lineage/runtimeRepository'

export const dynamic = 'force-dynamic'

function integer(value: string | null): number | undefined {
  if (value === null || !/^[0-9]+$/.test(value)) return undefined
  return Number(value)
}

export async function GET(request: NextRequest) {
  try {
    const result = await getFormalWorkLineageList({
      query: request.nextUrl.searchParams.get('q') || '',
      limit: integer(request.nextUrl.searchParams.get('limit')),
      offset: integer(request.nextUrl.searchParams.get('offset')),
    })
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('WorkLineage list read failed', error)
    return NextResponse.json(
      { code: 'work_lineage_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
