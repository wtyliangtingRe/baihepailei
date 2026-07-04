import configPromise from '@payload-config'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

type Role = 'admin' | 'editor' | 'reviewer' | 'trusted'

type CandidateSource = {
  source?: string
  externalId?: string
  url?: string
  note?: string
}

type WorkDoc = {
  id: string
  title?: string
  slug?: string
  siteId?: string
  rank?: string
  reviewStatus?: string
  evidenceStrength?: string
  evidenceNote?: string
  candidateSources?: CandidateSource[]
  importBatch?: string
  ratingNotice?: string
  chosenBaseSource?: string
  reviewReasons?: string[] | string
  sourceConflictNotes?: string
  status?: string
  updatedAt?: string
}

type Filters = {
  q: string
  rank: string
  source: string
  mode: 'focus' | 'all'
}

const allowedRoles: Role[] = ['admin', 'editor', 'reviewer']
const sourceOptions = ['mangadex', 'steam', 'yurizukan', 'bangumi', 'wikidata', 'anilist', 'vndb', 'wikipedia', 'ndl', 'manual', 'other']
const rankOptions = ['F', 'E', 'D', 'C', 'B', 'A', 'AA', 'unknown']
const collator = new Intl.Collator('zh-CN')

const v02ReviewQueueSiteIdOverrides = new Set([
  'work:mgv2-00326-身为女性向游戏的女主角挑战最强生存剧',
  'work:mgv2-00413-我亲爱的法医小姐',
])

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRank(value: string) {
  const rank = value.trim()
  if (!rank || rank === 'all') return 'all'
  if (rank.toUpperCase() === 'S') return 'AA'
  if (rank.toLowerCase() === 'unknown') return 'unknown'
  return rank.toUpperCase()
}

function normalizeSource(value: string) {
  const source = value.trim().toLowerCase()
  if (!source || source === 'all') return 'all'
  return sourceOptions.includes(source) ? source : 'all'
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const mode = firstParam(params.mode) === 'all' ? 'all' : 'focus'
  return {
    q: firstParam(params.q).trim(),
    rank: normalizeRank(firstParam(params.rank)),
    source: normalizeSource(firstParam(params.source)),
    mode,
  }
}

function getRole(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canView(user: unknown) {
  const role = getRole(user)
  return Boolean(role && allowedRoles.includes(role))
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : String(value || '')
}

function sourceValues(doc: WorkDoc) {
  const sources = doc.candidateSources || []
  return [
    ...new Set([
      ...sources.map((item) => item?.source),
      doc.chosenBaseSource,
    ].filter(Boolean)),
  ] as string[]
}

function primarySource(doc: WorkDoc) {
  return sourceValues(doc)[0] || 'unknown'
}

function reviewReasonValues(doc: WorkDoc) {
  const value = doc.reviewReasons

  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(';').map((item) => item.trim()).filter(Boolean))]
  }

  return []
}

function isPublicCatalogDoc(doc: WorkDoc) {
  const siteId = asText(doc.siteId)
  const note = asText(doc.evidenceNote)
  const importBatch = asText(doc.importBatch)

  return (
    importBatch.startsWith('public-catalog-import') ||
    siteId.startsWith('work:mgv2-') ||
    note.includes('Preview generated from mgv2-') ||
    /AI\s*综合，\s*待\s*复核/.test(note)
  )
}

function isFocusDoc(doc: WorkDoc) {
  const note = asText(doc.evidenceNote)
  const siteId = asText(doc.siteId)
  const reasons = reviewReasonValues(doc)

  return (
    v02ReviewQueueSiteIdOverrides.has(siteId) ||
    reasons.includes('radar_seed_attached') ||
    reasons.includes('source_conflict') ||
    reasons.includes('multi_source_or_variant') ||
    note.includes('Review notes:') ||
    note.includes('radar_seed_attached') ||
    note.includes('source_conflict')
  )
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function rankSortValue(rank?: string) {
  const order = ['F', 'E', 'D', 'C', 'B', 'A', 'AA', 'unknown']
  const index = order.indexOf(rank || 'unknown')
  return index === -1 ? order.length : index
}

function matchesQuery(doc: WorkDoc, q: string) {
  const query = normalizeText(q)
  if (!query) return true

  const haystack = [
    doc.title,
    doc.slug,
    doc.siteId,
    doc.rank,
    doc.reviewStatus,
    doc.evidenceStrength,
    doc.status,
    doc.evidenceNote,
    doc.importBatch,
    doc.ratingNotice,
    doc.chosenBaseSource,
    doc.sourceConflictNotes,
    ...reviewReasonValues(doc),
    ...sourceValues(doc),
  ]
    .map(normalizeText)
    .join('\n')

  return query
    .split(/\s+/g)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function matchesFilters(doc: WorkDoc, filters: Filters) {
  if (filters.mode === 'focus' && !isFocusDoc(doc)) return false
  if (filters.rank !== 'all' && (doc.rank || 'unknown') !== filters.rank) return false
  if (filters.source !== 'all' && !sourceValues(doc).includes(filters.source)) return false
  return matchesQuery(doc, filters.q)
}

function countBy(items: WorkDoc[], getKey: (item: WorkDoc) => string) {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = getKey(item) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.entries(counts).sort(([a], [b]) => collator.compare(a, b))
}

function shortNote(note?: string) {
  const text = asText(note).replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function detailUrl(doc: WorkDoc) {
  return doc.slug ? `/works/${doc.slug}` : '/works'
}

function adminUrl(doc: WorkDoc) {
  return `/admin/collections/works/${doc.id}`
}

export default async function PublicCatalogReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })

  if (!auth.user) {
    redirect(`/admin/login?redirect=${encodeURIComponent('/me/review/public-catalog')}`)
  }

  if (!canView(auth.user)) {
    return (
      <main style={{ margin: '0 auto', maxWidth: 960, padding: '48px 20px' }}>
        <p style={{ color: '#777', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Public Catalog Review</p>
        <h1>权限不足</h1>
        <p>这个页面目前只开放给 admin、editor、reviewer。</p>
        <p><Link href="/">返回首页</Link></p>
      </main>
    )
  }

  const filters = parseFilters(await searchParams)

  const result = await payload.find({
    collection: 'works',
    depth: 0,
    limit: 2000,
    overrideAccess: true,
    sort: 'title',
    where: {
      reviewStatus: {
        equals: 'pending',
      },
    },
  })

  const pendingDocs = result.docs as unknown as WorkDoc[]
  const publicCatalogDocs = pendingDocs.filter(isPublicCatalogDoc)
  const focusDocs = publicCatalogDocs.filter(isFocusDoc)

  const baseDocs = filters.mode === 'focus' ? focusDocs : publicCatalogDocs
  const filteredDocs = baseDocs
    .filter((doc) => matchesFilters(doc, filters))
    .sort((a, b) => {
      const rankDiff = rankSortValue(a.rank) - rankSortValue(b.rank)
      return rankDiff || collator.compare(a.title || '', b.title || '')
    })

  const rankStats = countBy(baseDocs, (doc) => doc.rank || 'unknown')
  const sourceStats = countBy(baseDocs, primarySource)

  return (
    <main style={{ margin: '0 auto', maxWidth: 1180, padding: '40px 20px 72px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: '#777', fontSize: 14, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' }}>Public Catalog Review</p>
          <h1 style={{ marginBottom: 8 }}>Public catalog 复核队列</h1>
          <p style={{ color: '#666', lineHeight: 1.7, marginTop: 0, maxWidth: 760 }}>
            只读内部页。当前不写 Payload、不改 PostgreSQL、不批量更新。默认显示 evidenceNote 含 Review notes / radar_seed_attached / source_conflict 的重点复核项。
          </p>
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 16, minWidth: 240, padding: 16 }}>
          <strong>当前匹配</strong>
          <p style={{ color: '#666', margin: '8px 0 0' }}>{filters.mode === 'focus' ? '重点复核' : '全部 public catalog pending'}</p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '8px 0 0' }}>{filteredDocs.length}</p>
        </div>
      </div>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 24 }}>
        <StatCard label="Pending total" value={pendingDocs.length} />
        <StatCard label="Public catalog" value={publicCatalogDocs.length} />
        <StatCard label="Focus queue" value={focusDocs.length} />
        <StatCard label="Fetched docs" value={result.docs.length} />
      </section>

      {focusDocs.length !== 50 ? (
        <div style={{ background: '#fff8e6', border: '1px solid #f0d48a', borderRadius: 14, lineHeight: 1.7, marginTop: 18, padding: 14 }}>
          <strong>提示：</strong>
          handoff 里的 review queue 是 50 条。如果这里不是 50，请检查结构化 reviewReasons / importBatch 是否已回填；当前页面仍保留 evidenceNote fallback。
        </div>
      ) : null}

      <form action="/me/review/public-catalog" style={{ border: '1px solid #ddd', borderRadius: 18, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 24, padding: 18 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>关键词</span>
          <input defaultValue={filters.q} name="q" placeholder="title / slug / siteId / reason / note" style={{ padding: '10px 12px' }} type="search" />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>视图</span>
          <select defaultValue={filters.mode} name="mode" style={{ padding: '10px 12px' }}>
            <option value="focus">重点复核</option>
            <option value="all">全部 pending</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>分级</span>
          <select defaultValue={filters.rank} name="rank" style={{ padding: '10px 12px' }}>
            <option value="all">全部分级</option>
            {rankOptions.map((rank) => (
              <option key={rank} value={rank}>{rankLabel(rank)}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>来源</span>
          <select defaultValue={filters.source} name="source" style={{ padding: '10px 12px' }}>
            <option value="all">全部来源</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
        </label>

        <div style={{ alignItems: 'end', display: 'flex', gap: 10 }}>
          <button style={{ padding: '10px 16px' }} type="submit">筛选</button>
          <Link href="/me/review/public-catalog">重置</Link>
        </div>
      </form>

      <section style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 24 }}>
        <SummaryBox title="分级分布" rows={rankStats.map(([rank, count]) => [rankLabel(rank), count])} />
        <SummaryBox title="来源分布" rows={sourceStats} />
      </section>

      <section style={{ display: 'grid', gap: 14, marginTop: 24 }}>
        {filteredDocs.map((doc) => {
          const sources = sourceValues(doc)
          const reviewReasons = reviewReasonValues(doc)

          return (
            <article key={doc.id} style={{ border: '1px solid #ddd', borderRadius: 18, padding: 18 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>
                    <Link href={detailUrl(doc)}>{doc.title || '(untitled)'}</Link>
                  </h2>
                  <p style={{ color: '#666', margin: 0 }}>{doc.siteId || 'no siteId'}</p>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Badge>{rankLabel(doc.rank)}</Badge>
                  <Badge>{doc.reviewStatus || 'no reviewStatus'}</Badge>
                  <Badge>{doc.status || 'no status'}</Badge>
                </div>
              </div>

              <dl style={{ display: 'grid', gap: 8, gridTemplateColumns: '120px 1fr', marginTop: 14 }}>
                <dt style={{ color: '#666' }}>slug</dt>
                <dd style={{ margin: 0 }}>{doc.slug || '-'}</dd>

                <dt style={{ color: '#666' }}>sources</dt>
                <dd style={{ margin: 0 }}>{sources.length ? sources.join(', ') : '-'}</dd>

                <dt style={{ color: '#666' }}>import batch</dt>
                <dd style={{ margin: 0 }}>{doc.importBatch || '-'}</dd>

                <dt style={{ color: '#666' }}>review reasons</dt>
                <dd style={{ margin: 0 }}>{reviewReasons.length ? reviewReasons.join(', ') : '-'}</dd>

                <dt style={{ color: '#666' }}>rating notice</dt>
                <dd style={{ margin: 0 }}>{doc.ratingNotice || '-'}</dd>

                <dt style={{ color: '#666' }}>base source</dt>
                <dd style={{ margin: 0 }}>{doc.chosenBaseSource || '-'}</dd>

                <dt style={{ color: '#666' }}>source conflict</dt>
                <dd style={{ margin: 0 }}>{doc.sourceConflictNotes || '-'}</dd>

                <dt style={{ color: '#666' }}>evidence</dt>
                <dd style={{ margin: 0 }}>{shortNote(doc.evidenceNote) || '-'}</dd>
              </dl>

              {doc.evidenceNote ? (
                <details style={{ marginTop: 12 }}>
                  <summary>展开完整 evidenceNote</summary>
                  <pre style={{ background: '#f7f7f7', borderRadius: 12, overflow: 'auto', padding: 12, whiteSpace: 'pre-wrap' }}>{doc.evidenceNote}</pre>
                </details>
              ) : null}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <Link href={detailUrl(doc)}>打开作品页</Link>
                <Link href={adminUrl(doc)}>打开 Admin 编辑页</Link>
              </div>
            </article>
          )
        })}

        {filteredDocs.length === 0 ? (
          <div style={{ border: '1px solid #ddd', borderRadius: 18, padding: 24 }}>
            <h2>没有匹配项</h2>
            <p>可以切换到“全部 pending”，或者清空关键词、分级、来源筛选。</p>
          </div>
        ) : null}
      </section>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 14, padding: 14 }}>
      <span style={{ color: '#666', display: 'block' }}>{label}</span>
      <strong style={{ fontSize: 24 }}>{value}</strong>
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span style={{ border: '1px solid #ddd', borderRadius: 999, padding: '5px 9px' }}>{children}</span>
}

function SummaryBox({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 16, padding: 16 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>{title}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {rows.map(([label, count]) => (
          <span key={label} style={{ border: '1px solid #ddd', borderRadius: 999, padding: '6px 10px' }}>
            {label} · {count}
          </span>
        ))}
      </div>
    </div>
  )
}

