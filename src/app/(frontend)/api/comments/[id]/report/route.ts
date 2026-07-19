import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import configPromise from '@payload-config'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) return NextResponse.json({ error: 'login_required' }, { status: 401 })

  const current = await payload.findByID({
    collection: 'comments',
    id,
    depth: 0,
    overrideAccess: true,
  }) as unknown as {
    id: string | number
    reportCount?: number
    reportedBy?: Array<string | number | { id?: string | number }>
    moderationStatus?: string
  }

  const actorID = (auth.user as { id?: string | number }).id
  if (actorID === undefined || actorID === null) return NextResponse.json({ error: 'login_required' }, { status: 401 })
  const reporterIDs = (current.reportedBy || []).map((value) => String(typeof value === 'object' ? value.id : value))
  if (reporterIDs.includes(String(actorID))) {
    return NextResponse.json({ ok: true, alreadyReported: true, reportCount: current.reportCount || reporterIDs.length })
  }

  const reportCount = Math.max(Number(current.reportCount || 0), reporterIDs.length) + 1
  const hidden = reportCount >= 3
  const updated = await payload.update({
    collection: 'comments',
    id,
    depth: 0,
    overrideAccess: true,
    context: { automatedAbuseProtection: true },
    data: {
      reportCount,
      reportedBy: [...reporterIDs, actorID],
      ...(hidden ? { moderationStatus: 'hidden', hiddenReason: 'auto_hidden_after_reports' } : {}),
    },
  })

  return NextResponse.json({
    ok: true,
    reportCount,
    autoHidden: hidden,
    doc: updated,
  })
}
