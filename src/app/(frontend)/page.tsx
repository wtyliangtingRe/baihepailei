import Link from 'next/link'

import { readSearchIndex } from './_lib/search-index'

const sections = [
  {
    kind: 'works',
    href: '/works',
    eyebrow: '作品',
    title: '作品',
    description: '浏览轻量索引里的作品条目，后续会逐步升级为完整正文详情页。',
  },
  {
    kind: 'creators',
    href: '/creators',
    eyebrow: '创作者',
    title: '创作者',
    description: '查看从旧 XWiki 清理出来的创作者相关资料。',
  },
  {
    kind: 'terms',
    href: '/terms',
    eyebrow: '名词解释',
    title: '名词解释',
    description: '集中浏览迁移后的概念、术语和解释性条目。',
  },
  {
    kind: 'rules',
    href: '/rules',
    eyebrow: '排雷规则',
    title: '排雷规则',
    description: '整理旧站中的原则、说明与轻量规则内容。',
  },
]

function countLabel(count?: number) {
  if (typeof count !== 'number') return '待生成索引'
  return `${count} 条`
}

export default function HomePage() {
  const index = readSearchIndex()

  return (
    <main className="home">
      <div className="home-stack">
        <section className="hero">
          <p className="eyebrow">百合排雷 · 轻量版</p>
          <h1>百合作品排雷资料库</h1>
          <p>
            这里会重做为结构化资料站：作品、创作者、名词解释和排雷规则都在 Payload 后台维护，前台优先提供轻量文字浏览与快速搜索。
          </p>
          <form action="/search" className="search-box" role="search">
            <span>快速搜索</span>
            <input id="home-search-input" name="q" placeholder="输入作品名、作者、分级或旧站关键词" type="search" />
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
            <Link href="/admin">进入后台</Link>
          </div>
        </section>

        <section className="home-section-grid" aria-label="轻量资料分类">
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
