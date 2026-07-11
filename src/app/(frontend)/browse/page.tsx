import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex } from '../_lib/search-index'

const sections = [
  {
    kind: 'works',
    href: '/works',
    eyebrow: '作品',
    title: '作品',
    description: '以作品为核心浏览条目，适合从具体名称进入排雷信息。',
    actionLabel: '浏览作品',
  },
  {
    kind: 'creators',
    href: '/creators',
    eyebrow: '创作者',
    title: '创作者',
    description: '查看与创作者相关的资料，辅助判断作品来源与关联信息。',
    actionLabel: '浏览创作者',
  },
  {
    kind: 'organizations',
    href: '/organizations',
    eyebrow: '机构',
    title: '机构',
    description: '查看出版社、制作公司、平台、品牌、制作委员会等机构资料。',
    actionLabel: '浏览机构',
  },
  {
    kind: 'site-explanation',
    href: '/terms',
    eyebrow: '站点说明',
    title: '站点说明',
    description: '统一查看页面提示、用语说明入口与完整排雷规则入口。',
    actionLabel: '查看站点说明',
  },
]

function countLabel(index: ReturnType<typeof readSearchIndex>, kind: string) {
  if (kind === 'site-explanation') return '说明入口'
  return `${index?.counts[kind] || 0} 条`
}

export default function BrowsePage() {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const markedWorks = Number(index.visibilityCounts?.adult || 0) + Number(index.visibilityCounts?.restricted || 0)

  return (
    <main className="page">
      <section className="page-heading">
        <p className="eyebrow">资料库</p>
        <h1>浏览资料库</h1>
        <p>当前轻量索引共收录 {index.total} 个条目。你可以按内容类型浏览，也可以直接使用搜索。</p>
        {markedWorks ? <p className="content-visibility-note">普通模式默认隐藏 {markedWorks} 条标记作品；打开左上角“全部作品”后可显示。</p> : null}
        <div className="actions">
          <Link href="/search">开始搜索</Link>
          <Link href="/">返回首页</Link>
        </div>
      </section>

      <section className="results-list">
        {sections.map((section) => (
          <article className="result-card" key={section.kind}>
            <div className="result-card-header">
              <p>{section.eyebrow}</p>
              <span>{countLabel(index, section.kind)}</span>
            </div>
            <h2>{section.title}</h2>
            <p className="result-text">{section.description}</p>
            <Link className="result-link" href={section.href}>
              {section.actionLabel}
            </Link>
          </article>
        ))}
      </section>
    </main>
  )
}
