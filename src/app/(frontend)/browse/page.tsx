import Link from 'next/link'

import { getFormalWorkLineageList } from '@/lib/work-lineage/runtimeRepository'

export const dynamic = 'force-dynamic'

export default async function BrowsePage() {
  let total: number | null = null
  try {
    total = (await getFormalWorkLineageList({ limit: 1, offset: 0 })).total
  } catch (error) {
    console.error('Formal WorkLineage browse count failed', error)
  }

  return (
    <main className="page">
      <section className="page-heading site-guide-heading">
        <p className="eyebrow">新资料库</p>
        <h1>浏览正式数据</h1>
        <p>迁移后的生产数据面只包含正式 WorkLineage 与其 Provenance supporting objects。参考数据位于生产库外，旧评级已经丢弃。</p>
      </section>
      <section className="results-list">
        <article className="result-card">
          <div className="result-card-header"><p>正式作品</p><span>{total === null ? '不可用' : `${total.toLocaleString('zh-CN')} 条`}</span></div>
          <h2>作品与 IdentityBinding</h2>
          <p className="result-text">新数据库中唯一已经正式导入的内容域；可独立于全部旧数据运行。</p>
          <Link className="result-link" href="/works">浏览作品</Link>
        </article>
        <article className="result-card">
          <div className="result-card-header"><p>尚未正式导入</p><span>0 条</span></div>
          <h2>研究、评估与评级</h2>
          <p className="result-text">等待新的发现—研究—评估流程产生独立对象；不会从参考数据原地晋升。</p>
          <Link className="result-link" href="/radar">查看状态</Link>
        </article>
      </section>
    </main>
  )
}
