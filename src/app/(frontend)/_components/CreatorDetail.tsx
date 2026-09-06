import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPublicCreatorById, getPublicCreatorWorks } from '@/lib/publicRelease'
import type { CreatorKind, CreatorWork } from '@/lib/publicCreatorGraph'
import { gradeLabel, mediaLabel, publicStatusLabels } from '@/lib/radar/publicPresentation'
import { canonicalContentUrl, recordIdFromContentRoute } from '../_lib/content-identity'
import { type CreatorSearchParams, firstParam, pageNumber } from './CreatorDirectory'

type CreatorParams = Promise<{ slug: string }>
export async function creatorMetadata(kind: CreatorKind, params: CreatorParams): Promise<Metadata> {
  const { slug } = await params
  const id = recordIdFromContentRoute(kind === 'person' ? 'creators' : 'organizations', slug)
  const creator = id ? getPublicCreatorById(id) : null
  return creator?.kind === kind ? { title: `${creator.name}的作品`, description: `${creator.name}在百合排雷收录的作品，按年份查看。` } : {}
}

export default async function CreatorDetail({ kind, params, searchParams }: {
  kind: CreatorKind; params: CreatorParams; searchParams: CreatorSearchParams
}) {
  const { slug } = await params
  const collection = kind === 'person' ? 'creators' : 'organizations'
  const id = recordIdFromContentRoute(collection, slug)
  const creator = id ? getPublicCreatorById(id) : null
  if (!creator || creator.kind !== kind) notFound()
  const query = await searchParams, page = pageNumber(firstParam(query.page)), limit = 60
  const rawYear = firstParam(query.year)
  const year = /^(\d{4}|unknown)$/.test(rawYear) ? rawYear : ''
  const result = getPublicCreatorWorks(creator.creatorId, { year, offset: (page - 1) * limit, limit })
  const totalPages = Math.max(1, Math.ceil(result.total / limit))
  const route = canonicalContentUrl(collection, creator.creatorId)
  function href(page: number) {
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (page > 1) params.set('page', String(page))
    return `${route}${params.size ? `?${params}` : ''}`
  }
  if (page > totalPages) redirect(href(totalPages))
  const groups = new Map<string, CreatorWork[]>()
  for (const entry of result.items) groups.set(entry.year, [...(groups.get(entry.year) || []), entry])
  return (
    <main className="page collection-page creator-detail-page">
      <section className="page-heading collection-heading creator-heading">
        <p className="eyebrow">{kind === 'person' ? '作者 / 主创' : '创作机构'}</p>
        <h1>{creator.name}</h1>
        <p>本站收录 <strong>{result.allTotal.toLocaleString('zh-CN')}</strong> 部作品 · 按首次发行年份排列</p>
        {creator.identityBasis === 'unresolved_name' ? <p className="muted">该署名存在同名情况，目前仅列出已关联的作品。</p> : null}
        <div className="collection-actions">
          <Link className="back-link" href={`/${collection}`}>全部{kind === 'person' ? '作者 / 主创' : '创作机构'}</Link>
          <Link className="back-link" href="/works">作品目录</Link>
        </div>
      </section>
      <form className="creator-year-filter" action={route}>
        <label htmlFor="creator-year">发行年份</label>
        <select id="creator-year" name="year" defaultValue={year}>
          <option value="">全部年份</option>
          {result.years.map(y => <option key={y} value={y}>{y === 'unknown' ? '年份待确认' : `${y} 年`}</option>)}
        </select><button type="submit">查看</button>
        {year ? <Link href={route}>全部作品</Link> : null}
      </form>
      {[...groups].map(([year, entries]) => <section className="creator-year-section" key={year} aria-labelledby={`year-${year}`}>
        <h2 id={`year-${year}`}>{year === 'unknown' ? '年份待确认' : `${year} 年`}</h2>
        <ul className="creator-works">
          {entries.map(({ work, roles, names }) => <li key={work.workId}>
            <div className="creator-work-title">
              <Link href={canonicalContentUrl('works', work.workId)}>{work.title}</Link>
              <span>{mediaLabel(work.media.group, work.media.type)}{work.firstPublishedLabel || work.firstPublished ? ` · ${work.firstPublishedLabel || work.firstPublished}` : ''}</span>
              <small>{roles.join(' / ')}{names.some(name => name !== creator.name) ? ` · 署名：${names.join('、')}` : ''}</small>
            </div>
            <Link className="creator-work-rating" href={canonicalContentUrl('works', work.workId)} aria-label={`查看《${work.title}》的作品资料与评级`}>
              {work.rating.grade ? <><span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span><small>{gradeLabel(work.rating.grade)}</small></> :
                <span className="muted">{publicStatusLabels[work.rating.state]}</span>}
            </Link>
          </li>)}
        </ul>
      </section>)}
      {!result.items.length ? <p className="muted">{year ? '这个年份暂无已收录作品。' : '目前暂无已关联的收录作品。'}</p> : null}
      {totalPages > 1 ? <nav className="creator-pagination" aria-label="作品分页">
        {page > 1 ? <Link href={href(page - 1)} rel="prev">上一页</Link> : <span />}
        <span>第 {page} / {totalPages} 页 · {result.total} 部</span>
        {page < totalPages ? <Link href={href(page + 1)} rel="next">下一页</Link> : <span />}
      </nav> : null}
    </main>
  )
}
