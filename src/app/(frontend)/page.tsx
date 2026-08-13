import Link from 'next/link'

import { getFormalWorkLineageList } from '@/lib/work-lineage/runtimeRepository'

export const dynamic = 'force-dynamic'

async function formalWorkCount(): Promise<number | null> {
  try {
    return (await getFormalWorkLineageList({ limit: 1, offset: 0 })).total
  } catch (error) {
    console.error('Formal WorkLineage count failed', error)
    return null
  }
}

export default async function HomePage() {
  const workCount = await formalWorkCount()

  return (
    <main className="home">
      <div className="home-stack">
        <section className="hero">
          <p className="eyebrow">百合排雷 · 新资料库</p>
          <h1>百合作品资料库</h1>
          <p>
            当前只展示已经独立导入新数据库的正式作品与身份信息。历史研究和旧评级没有进入正式库；新的发现、研究与评估会产生全新的当前记录。
          </p>
          <form action="/search" className="search-box" role="search">
            <span>搜索正式作品</span>
            <input id="home-search-input" name="q" placeholder="输入作品名或精确 Work ID" type="search" />
            <button className="result-link" type="submit">搜索</button>
          </form>
          <div className="home-stats" aria-label="新数据库统计">
            <span>{workCount === null ? '正式作品库暂时不可用' : `正式作品：${workCount.toLocaleString('zh-CN')} 条`}</span>
            <span>当前研究：0 条</span>
            <span>当前评级：0 条</span>
          </div>
          <div className="actions">
            <Link href="/works">浏览正式作品</Link>
            <Link href="/browse">查看导入范围</Link>
            <Link href="/ratings">当前评级状态</Link>
            <Link href="/radar">当前研究状态</Link>
          </div>
        </section>

        <section className="home-section-grid" aria-label="新资料库分区">
          <Link className="home-section-card" href="/works">
            <div className="home-section-card-header">
              <p>正式数据</p>
              <span>{workCount === null ? '不可用' : `${workCount.toLocaleString('zh-CN')} 条`}</span>
            </div>
            <h2>作品与身份</h2>
            <span>读取新数据库中自包含的 Frozen WorkLineage 与 IdentityBinding。</span>
          </Link>
          <Link className="home-section-card" href="/ratings">
            <div className="home-section-card-header"><p>新流程</p><span>0 条</span></div>
            <h2>当前评级</h2>
            <span>旧评级已丢弃；这里只会出现新研究与新评估产生的结论。</span>
          </Link>
          <Link className="home-section-card" href="/radar">
            <div className="home-section-card-header"><p>新流程</p><span>0 条</span></div>
            <h2>当前研究</h2>
            <span>参考资料保持隔离，不能原地升级为正式研究对象。</span>
          </Link>
        </section>
      </div>
    </main>
  )
}
