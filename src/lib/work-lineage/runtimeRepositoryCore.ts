export const FROZEN_WORK_LINEAGE_BLOCKS = [
  'canonical',
  'identities',
  'research',
  'assessment',
  'candidate',
  'published',
  'human',
  'legacy',
  'reservations',
  'quarantine',
  'effectiveState',
  'integrity',
  'provenance',
] as const

const ACTIVE_WORK_LINEAGE_BLOCKS = FROZEN_WORK_LINEAGE_BLOCKS.filter(
  (block) => block !== 'legacy',
)

const FORMAL_TOP_LEVEL_KEYS = new Set([
  'contractVersion',
  'workId',
  ...ACTIVE_WORK_LINEAGE_BLOCKS,
])

export type WorkLineageDocument = {
  contractVersion: 'global-work-lineage-v01'
  workId: string
  canonical: {
    naming: {
      canonicalTitle: string
      names: string[]
    }
    [key: string]: unknown
  }
  identities: Record<string, unknown>
  research: Record<string, unknown>
  assessment: Record<string, unknown>
  candidate: Record<string, unknown>
  published: Record<string, unknown>
  human: Record<string, unknown>
  reservations: Record<string, unknown>
  quarantine: Record<string, unknown>
  effectiveState: Record<string, unknown>
  integrity: Record<string, unknown>
  provenance: Record<string, unknown>
}

type QueryResult<Row> = {
  rows: Row[]
}

export type QueryExecutor = {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

type StoredWorkLineage = {
  work_id: string
  document_sha256: string
  document: unknown
}

type CountRow = {
  total: string | number
}

export type WorkLineageListItem = {
  workId: string
  canonicalTitle: string
  identityState: string
  currentConclusionState: string
  documentSha256: string
}

export type WorkLineageListResult = {
  items: WorkLineageListItem[]
  total: number
  limit: number
  offset: number
}

export function assertFormalWorkLineageDocument(
  value: unknown,
  expectedWorkId?: string,
): asserts value is WorkLineageDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('WorkLineage runtime row is not an object')
  }

  const document = value as Record<string, unknown>
  const keys = Object.keys(document)
  if (
    keys.length !== FORMAL_TOP_LEVEL_KEYS.size ||
    keys.some((key) => !FORMAL_TOP_LEVEL_KEYS.has(key))
  ) {
    throw new Error('WorkLineage runtime row does not match the active Frozen block set')
  }
  if (FROZEN_WORK_LINEAGE_BLOCKS.length !== 13 || 'legacy' in document) {
    throw new Error('Frozen 13-block or retired Legacy boundary drift')
  }
  if (document.contractVersion !== 'global-work-lineage-v01') {
    throw new Error('WorkLineage contract version drift')
  }

  const workId = String(document.workId || '')
  if (!workId || (expectedWorkId && workId !== expectedWorkId)) {
    throw new Error('WorkLineage identity mismatch')
  }
  const canonical = document.canonical as Record<string, unknown> | undefined
  const naming = canonical?.naming as Record<string, unknown> | undefined
  if (!String(naming?.canonicalTitle || '').trim()) {
    throw new Error('WorkLineage canonical title is missing')
  }
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return 50
  return Math.min(Number(value), 100)
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return 0
  return Math.min(Number(value), 1_000_000)
}

export async function findFormalWorkLineageById(
  executor: QueryExecutor,
  workId: string,
): Promise<{ document: WorkLineageDocument; documentSha256: string } | null> {
  const exactWorkId = String(workId || '').trim()
  if (!exactWorkId || exactWorkId.length > 200) return null

  const result = await executor.query<StoredWorkLineage>(
    `SELECT work_id, document_sha256, document
     FROM global_work_lineage_v01.work_lineages
     WHERE work_id = $1
     LIMIT 1`,
    [exactWorkId],
  )
  const row = result.rows[0]
  if (!row) return null
  assertFormalWorkLineageDocument(row.document, row.work_id)
  return {
    document: row.document,
    documentSha256: row.document_sha256,
  }
}

export async function listFormalWorkLineages(
  executor: QueryExecutor,
  input: { query?: string; limit?: number; offset?: number } = {},
): Promise<WorkLineageListResult> {
  const query = String(input.query || '').trim().slice(0, 200)
  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  const values: unknown[] = []
  let where = ''
  if (query) {
    values.push(query)
    where = `WHERE canonical_title ILIKE '%' || $1 || '%' OR work_id = $1`
  }
  values.push(limit, offset)
  const limitParameter = query ? 2 : 1
  const offsetParameter = query ? 3 : 2

  const [countResult, result] = await Promise.all([
    executor.query<CountRow>(
      `SELECT count(*)::text AS total
       FROM global_work_lineage_v01.work_lineages
       ${where}`,
      query ? [query] : [],
    ),
    executor.query<StoredWorkLineage>(
      `SELECT work_id, document_sha256, document
       FROM global_work_lineage_v01.work_lineages
       ${where}
       ORDER BY lower(canonical_title), work_id
       LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      values,
    ),
  ])
  const items = result.rows.map((row) => {
    assertFormalWorkLineageDocument(row.document, row.work_id)
    const document = row.document
    const identities = document.identities as {
      observation?: { state?: string }
    }
    const effectiveState = document.effectiveState as {
      ai?: { selection?: { currentConclusionState?: string } }
    }
    return {
      workId: document.workId,
      canonicalTitle: document.canonical.naming.canonicalTitle,
      identityState: String(identities.observation?.state || 'unknown'),
      currentConclusionState: String(
        effectiveState.ai?.selection?.currentConclusionState || 'unknown',
      ),
      documentSha256: row.document_sha256,
    }
  })
  const total = Number(countResult.rows[0]?.total || 0)
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('WorkLineage total count is invalid')
  }
  return { items, total, limit, offset }
}
