import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../../../_lib/content-identity'

export const dynamic = 'force-dynamic'
type EntityCollection = 'creators' | 'organizations'
function collectionOf(value: string): EntityCollection | null { return value === 'organizations' ? 'organizations' : value === 'creators' ? 'creators' : null }
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || '' : value || '' }
function roleOf(user: unknown) { return user && typeof user === 'object' ? String((user as { role?: string }).role || '') : '' }
function canEdit(user: unknown) { return new Set(['owner', 'admin', 'editor']).has(roleOf(user)) }

export default async function EntityStudioList({ params, searchParams }: { params: Promise<{ collection: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { collection: rawCollection } = await params
  const collection = collectionOf(rawCollection)
  if (!collection) redirect('/me/studio')
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect('/account/login?redirect=' + encodeURIComponent('/me/studio/entities/' + rawCollection))
  if (!canEdit(auth.user)) return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>创作者与机构编辑仅开放给最高领袖、管理员和编辑。</p></section></main>
  const raw = await searchParams
  const q = first(raw.q).trim().slice(0, 160)
  const page = Math.max(1, Number(first(raw.page) || 1) || 1)
  const where: Where = q ? { or: [{ name: { like: q } }, { slug: { like: q } }, { siteId: { like: q } }, { searchText: { like: q } }] } : {}
  const result = await payload.find({ collection, depth: 0, draft: true, limit: 50, page, pagination: true, sort: '-updatedAt', overrideAccess: true, where })
  const totalPages = Math.max(1, result.totalPages || 1)
  return (
    <main className="page review-workbench">
      <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">站内内容管理</p><h1>{collection === 'creators' ? '创作者完整编辑' : '机构完整编辑'}</h1><p className="muted">这里和作品工作台一样直接读写 Payload。审核来源、别名、可见性、搜索文本和人工记录都在同一页保存。</p></div><div className="review-row-actions"><Link className="review-link" href="/me/studio">返回作品工作台</Link><Link className="review-link" href={'/me/review/content?collection=' + collection}>进入审核队列</Link></div></section>
      <form className="review-filter-panel" action={'/me/studio/entities/' + collection}><label><span>搜索名称、Slug、站内 ID</span><input defaultValue={q} name="q" placeholder="名称、别名、Slug、Site ID" /></label><button className="review-button" type="submit">搜索</button></form>
      <nav className="review-pagination" aria-label="实体编辑分页">{page > 1 ? <Link href={'/me/studio/entities/' + collection + '?q=' + encodeURIComponent(q) + '&page=' + (page - 1)}>上一页</Link> : null}<span>第 {page} / {totalPages} 页</span>{page < totalPages ? <Link href={'/me/studio/entities/' + collection + '?q=' + encodeURIComponent(q) + '&page=' + (page + 1)}>下一页</Link> : null}</nav>
      <section className="review-list">
        {result.docs.map((doc) => {
          const item = doc as unknown as { id: string | number; name?: string; slug?: string; siteId?: string; rank?: string; type?: string; reviewStatus?: string; status?: string }
          return <article className="review-row review-content-row" key={String(item.id)}><header className="review-row-header"><div className="review-row-title"><h2>{item.name || ('记录 #' + item.id)}</h2><small>ID：{item.id} · {item.siteId || '无 Site ID'}</small></div><div className="review-chip-list"><span>{collection === 'creators' ? (item.rank || '未知') + '级' : item.type || '其他'}</span><span>{item.reviewStatus || 'pending'}</span><span>{item.status || 'draft'}</span></div></header><div className="review-content-actions"><Link className="review-button review-button-primary" href={'/me/studio/entities/' + collection + '/' + item.id}>完整编辑</Link><Link className="review-link" href={canonicalContentUrl(collection, item.id)}>查看前台</Link></div></article>
        })}
        {result.docs.length === 0 ? <section className="review-empty"><h2>没有匹配记录</h2><p>可以搜索别名、Slug 或站内 ID。</p></section> : null}
      </section>
    </main>
  )
}