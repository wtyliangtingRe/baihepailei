import configPromise from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'

import { readSearchIndex } from './_lib/search-index'

export const dynamic = 'force-dynamic'

const sections = [
  {
    kind: 'works',
    href: '/works',
    eyebrow: '作品',
    title: '作品',
    description: '浏览作品条目、排雷分级、页面提示与资料状态。',
  },
  {
    kind: 'ratings',
    href: '/ratings',
    eyebrow: '大众评级',
    title: '作品排雷评级',
    description: '公开查看机器等级、置信度、判断摘要、标签提示与人工复核状态。',
  },
  {
    kind: 'radar',
    href: '/radar',
    eyebrow: '注册用户资料区',
    title: 'Radar 研究档案',
    description: '登录后只读查看事实、证据与来源绑定；只有编辑以上可以下载完整 JSON。',
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

async function currentRadarCounts() {
  try {
    const payload = await getPayload({ config: configPromise })
    const [records, ratings] = await Promise.all([
      payload.find({
        collection: 'radar-public-records',
        depth: 0,
        limit: 1,
        page: 1,
        pagination: true,
        overrideAccess: true,
        where: { recordStatus: { equals: 'current' } },
      }),
      payload.find({
        collection: 'radar-public-ratings',
        depth: 0,
        limit: 1,
        page: 1,
        pagination: true,
        overrideAccess: true,
        where: { recordStatus: { equals: 'current' } },
      }),
    ])
    return { records: records.totalDocs, ratings: ratings.totalDocs }
  } catch {
    return { records: undefined, ratings: undefined }
  }
}

export default async function HomePage() {
  const index = readSearchIndex()
  const radarCounts = await currentRadarCounts()

  return (
    <main className="home">
      <div className="home-stack">
        <section className="hero">
          <p className="eyebrow">百合排雷 · 资料库</p>
          <h1>百合作品排雷资料库</h1>
          <p>
            这里整理作品、创作者、机构、排雷分级与页面提示。读者可以通过结构化条目、公开评级和证据说明，更快判断作品是否适合自己。
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
            {typeof radarCounts.ratings === 'number' ? <span>公开评级：{radarCounts.ratings} 条</span> : null}
            {typeof radarCounts.records === 'number' ? <span>注册用户研究档案：{radarCounts.records} 条</span> : null}
            {index?.generatedAt ? <span>索引生成：{new Date(index.generatedAt).toLocaleString('zh-CN')}</span> : null}
          </div>
          <div className="actions">
            <Link href="/browse">浏览资料库</Link>
            <Link href="/works">浏览作品</Link>
            <Link href="/ratings">查看大众评级</Link>
            <Link href="/radar">登录后查看研究档案</Link>
            <Link href="/search">开始搜索</Link>
            <Link href="/me/lists">我的列表</Link>
          </div>
        </section>

        <section className="home-section-grid" aria-label="资料分类">
          {sections.map((section) => {
            const count = section.kind === 'ratings'
              ? radarCounts.ratings
              : section.kind === 'radar'
                ? radarCounts.records
                : index?.counts?.[section.kind]
            return (
              <Link className="home-section-card" href={section.href} key={section.href}>
                <div className="home-section-card-header">
                  <p>{section.eyebrow}</p>
                  <span>{countLabel(count)}</span>
                </div>
                <h2>{section.title}</h2>
                <span>{section.description}</span>
              </Link>
            )
          })}
        </section>
      </div>
    </main>
  )
}
