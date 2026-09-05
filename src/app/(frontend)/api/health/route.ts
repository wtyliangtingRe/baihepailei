import { NextResponse } from 'next/server'

import { getPublicCatalogMergeStats, getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export function GET() {
  try {
    const manifest = getPublicReleaseManifest()
    const merge = getPublicCatalogMergeStats()
    return NextResponse.json({
      ok: true,
      releaseId: manifest.releaseId,
      catalogWorks: manifest.counts.catalogWorks,
      visibleWorks: merge.visibleWorks,
      mergedAway: merge.mergedAway,
      mergedGroups: merge.multiWorkGroups,
      largestMergedGroup: merge.largestGroup,
      ratedWorks: manifest.counts.ratedWorks,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Public release health check failed', error)
    return NextResponse.json(
      { ok: false, code: 'public_release_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
