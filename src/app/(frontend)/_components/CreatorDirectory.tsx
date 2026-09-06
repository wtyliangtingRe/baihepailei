import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPublicCreatorList } from '@/lib/publicRelease'
import type { CreatorKind } from '@/lib/publicCreatorGraph'
import { canonicalContentUrl } from '../_lib/content-identity'

export type CreatorSearchParams = Promise<Record<string, string | string[] | undefined>>
export const firstParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || '' : value || ''
export const pageNumber = (value: string) => /^\d+$/.test(value) ? Math.min(10000, Math.max(1, Number(value))) : 1

export default async function CreatorDirectory({ kind, searchParams }: { kind: CreatorKind; searchParams: CreatorSearchParams }) {
  const params = await searchParams
  const q = firstParam(params.q).trim().slice(0, 200)
  const page = pageNumber(firstParam(params.page)), limit = 60
  const collection = kind === 'person' ? 'creators' : 'organizations'
  const title = kind === 'person' ? '作者 / 主创' : '创作机构'
  const result = getPublicCreatorList({ kind, query: q, offset: (page - 1) * limit, limit })
  const totalPages = Math.max(1, Math.ceil(result.total / limit))
  function href(page: number) {
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    if (page > 1) query.set('page', String(page))
    return `/${collection}${query.size ? `?${query}` : ''}`
  }
  if (page > totalPages) redirect(href(totalPages))
  return (
    <main className="page collection-page release-creators-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">创作信息</p>
        <h1>{title}</h1>
        <p>查看作者与机构在本站收录的作品。</p>
        <div className="collection-actions">
          <Link href="/creators" aria-current={kind === 'person' ? 'page' : undefined}>作者 / 主创</Link>
          <Link href="/organizations" aria-current={kind === 'organization' ? 'page' : undefined}>创作机构</Link>
          <Link href="/works">作品目录</Link>
        </div>
      </section>
      <form className="creator-search" action={`/${collection}`}>
        <label htmlFor="creator-query">{kind === 'person' ? '作者姓名 / 别名' : '机构名称 / 别名'}</label>
        <div><input defaultValue={q} id="creator-query" name="q" type="search" maxLength={200} /><button type="submit">搜索</button></div>
      </form>
      <p className="muted">{result.total.toLocaleString('zh-CN')} {kind === 'person' ? '位作者 / 主创' : '家机构'}</p>
      {result.items.length ? <ul className="creator-directory">
        {result.items.map(creator => <li key={creator.creatorId}>
          <Link href={canonicalContentUrl(collection, creator.creatorId)}>
            <strong>{creator.name}</strong><span>本站收录 {creator.workCount} 部</span>
          </Link>
        </li>)}
      </ul> : <p className="muted">没有找到这个名称。</p>}
      {totalPages > 1 ? <nav className="creator-pagination" aria-label="创作者列表分页">
        {page > 1 ? <Link href={href(page - 1)} rel="prev">上一页</Link> : <span />}
        <span>第 {page} / {totalPages} 页</span>
        {page < totalPages ? <Link href={href(page + 1)} rel="next">下一页</Link> : <span />}
      </nav> : null}
    </main>
  )
}
