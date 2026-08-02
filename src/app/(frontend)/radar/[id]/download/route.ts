import configPromise from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

export const dynamic = 'force-dynamic'

type RecordStatus = 'current' | 'withdrawn'

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }) + '\n', {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function safeFilenamePart(value: unknown) {
  const normalized = String(value || '').normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.slice(0, 80) || 'record'
}

function recordStatusOf(value: unknown): RecordStatus {
  return value === 'withdrawn' ? 'withdrawn' : 'current'
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })

  if (!auth.user) return jsonError('需要登录。', 401)
  if (!isEditor(auth.user)) return jsonError('只有编辑以上权限可以下载。', 403)

  let record: Record<string, unknown>
  try {
    record = await payload.findByID({
      collection: 'radar-public-records',
      id,
      depth: 0,
      overrideAccess: true,
    }) as unknown as Record<string, unknown>
  } catch {
    return jsonError('找不到 Radar 研究记录。', 404)
  }

  const publicationKey = String(record.publicationKey || '')
  const recordStatus = recordStatusOf(record.recordStatus)
  const ratingResult = await payload.find({
    collection: 'radar-public-ratings',
    depth: 0,
    limit: 1,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where: {
      and: [
        { publicationKey: { equals: publicationKey } },
        { recordStatus: { equals: recordStatus } },
      ],
    },
  })

  const rating = ratingResult.docs[0] || null
  const body = JSON.stringify({
    schemaVersion: 'radar-registered-record-download-v01',
    exportedAt: new Date().toISOString(),
    exportedByRole: 'editor_or_above',
    record,
    rating,
  }, null, 2) + '\n'
  const fileKey = safeFilenamePart(record.workSiteId || record.id || id)

  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="radar-${fileKey}.json"`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
