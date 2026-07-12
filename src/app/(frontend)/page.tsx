import Link from 'next/link'

import { readSearchIndex } from './_lib/search-index'

const sections = [
  {
    kind: 'works',
    href: '/works',
    eyebrow: '作品',
    title: '作品',
    description: '浏览作品条目、排雷分级、页面提示与资料状态。',
  },
  {
    kind: 'creators',
    href: '/creators',
    eyebrow: '创作者',
    title: '创作者',
    description: '查看创作者资料、别名与关联条目。创作者暂不做单独评级。',
  },
  {
    kind: 'organizations',
    href: '/organizations',
    eyebrow: '机构',
    title: '机构',
    description: '查看出版社、制作公司、平台、品牌、制作委员会等机构资料。',
  },
  {
    kind: 'site-explanation',
    href: '/terms',
    eyebrow: '站点说明',
    title: '站点说明',
    description: '查看页面提示、用语说明入口和完整排雷规则入口。',
  },
]

function countLabel(count?: number) {
  if (typeof count !== 'number') return '查看说明'
  return `${count} 条`
}

export default function HomePage() {
  const index = readSearchIndex()

  return (
    <main className="home">
      <div className="home-stack">
        <section className="hero">
          <p className="eyebrow">百合排雷 · 资料库</p>
          <h1>百合作品排雷资料库</h1>
          <p>
            这里整理作品、创作者、机构、排雷分级与页面提示。读者可以通过结构化条目、公开资料和证据说明，更快判断作品是否适合自己。
          </p>
          <form action="/search" className="search-box" role="search">
            <span>快速搜索</span>
            <input id="home-search-input" name="q" placeholder="输入作品名、作者、机构、分级或关键词" type="search" />
            <label className="home-search-scope" htmlFor="home-search-collection">
              <span>搜索范围</span>
              <select defaultValue="all" id="home-search-collection" name="collection">
                <option value="all">全部资料</option>
                <option value="works">只搜作品</option>
                <option value="creators">只搜创作者</option>
                <option value="organizations">只搜机构</option>
              </select>
            </label>
            <button className="result-link" type="submit">搜索资料</button>
          </form>
          <div className="home-stats" aria-label="当前索引统计">
            <span>{index ? `当前收录 ${index.total} 条` : '生成索引后显示条目数'}</span>
            {index?.generatedAt ? <span>索引生成：{new Date(index.generatedAt).toLocaleString('zh-CN')}</span> : null}
          </div>
          <div className="actions">
            <Link href="/browse">浏览资料库</Link>
            <Link href="/works">浏览作品</Link>
            <Link href="/search">开始搜索</Link>
            <Link href="/me/lists">我的列表</Link>
          </div>
        </section>

        <section className="home-section-grid" aria-label="资料分类">
          {sections.map((section) => (
            <Link className="home-section-card" href={section.href} key={section.href}>
              <div className="home-section-card-header">
                <p>{section.eyebrow}</p>
                <span>{countLabel(index?.counts?.[section.kind])}</span>
              </div>
              <h2>{section.title}</h2>
              <span>{section.description}</span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  )
}
