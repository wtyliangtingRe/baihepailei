import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import configPromise from '@payload-config'

type Params = { params: Promise<{ id: string }> }

function numericID(value: unknown) {
  const parsed = Number(typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const commentID = numericID(id)
  if (commentID === null) return NextResponse.json({ error: 'invalid_comment_id' }, { status: 400 })

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) return NextResponse.json({ error: 'login_required' }, { status: 401 })

  const current = await payload.findByID({
    collection: 'comments',
    id: commentID,
    depth: 0,
    overrideAccess: true,
  }) as unknown as {
    id: number
    reportCount?: number
    reportedBy?: Array<number | { id?: number }>
    moderationStatus?: string
  }

  const actorID = numericID((auth.user as { id?: unknown }).id)
  if (actorID === null) return NextResponse.json({ error: 'login_required' }, { status: 401 })

  const reporterIDs = (current.reportedBy || [])
    .map((value) => numericID(value))
    .filter((value): value is number => value !== null)

  if (reporterIDs.includes(actorID)) {
    return NextResponse.json({ ok: true, alreadyReported: true, reportCount: current.reportCount || reporterIDs.length })
  }

  const reportCount = Math.max(Number(current.reportCount || 0), reporterIDs.length) + 1
  const hidden = reportCount >= 3
  const updated = await payload.update({
    collection: 'comments',
    id: commentID,
    depth: 0,
    overrideAccess: true,
    context: { automatedAbuseProtection: true, auditActorID: (auth.user as { id?: string | number }).id },
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
