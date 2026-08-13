import { NextResponse } from 'next/server'

import { getFormalWorkLineageById } from '@/lib/work-lineage/runtimeRepository'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  try {
    const { workId } = await context.params
    const result = await getFormalWorkLineageById(workId)
    if (!result) {
      return NextResponse.json(
        { code: 'work_lineage_not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('WorkLineage exact read failed', error)
    return NextResponse.json(
      { code: 'work_lineage_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
