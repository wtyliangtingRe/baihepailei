import Link from 'next/link'

import PersonalRecommendationPanel from '../_components/PersonalRecommendationPanel'
import { readDetailIndex } from '../_lib/detail-index'
import { recommendedWorks, recommendationsByBucket, type RecommendedWork } from '../_lib/recommendations'

const reasonLabels: Record<string, string> = {
  'rank-good': '分级较高',
  'rank-mid': '分级中等',
  'rank-risk': '分级风险较高',
  reviewed: '已复核',
  disputed: '存在争议',
  deprecated: '已废弃',
  'evidence-ok': '证据较充分',
  'evidence-present': '已有材料',
  'evidence-missing': '材料不足',
  'matrix-missing': '矩阵未填写',
  'male-none': '男性影响低',
  'male-severe': '男性影响严重',
  'relationship-confirmed': '关系明确',
  'relationship-friendship': '友情向风险',
  'ending-safe': '结局安全',
  'ending-bad': '结局明确雷',
  'creator-severe': '创作者风险严重',
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function reasonText(code: string) {
  return reasonLabels[code] || code
}

function RecommendationCard({ work }: { work: RecommendedWork }) {
  return (
    <Link className="recommendation-card" href={work.item.url}>
      <div>
        <span>{rankLabel(work.item.rank)}</span>
        <span>{work.score} 分</span>
      </div>
      <h3>{work.item.title}</h3>
      {work.item.originalTitle ? <p>{work.item.originalTitle}</p> : null}
      <ul>
        {work.reasonCodes.slice(0, 5).map((code) => (
          <li key={code}>{reasonText(code)}</li>
        ))}
      </ul>
    </Link>
  )
}

function RecommendationGroup({ title, description, works }: { title: string; description: string; works: RecommendedWork[] }) {
  return (
    <section className="recommendation-section">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">{works.length} 个作品</p>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
      </div>

      {works.length === 0 ? (
        <p className="muted">暂无作品进入这一组。</p>
      ) : (
        <div className="recommendation-grid">
          {works.slice(0, 12).map((work) => (
            <RecommendationCard key={work.item.id} work={work} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function RecommendationsPage() {
  const index = readDetailIndex()
  const items = index?.items || []
  const groups = recommendationsByBucket(items)
  const allRecommendations = recommendedWorks(items)

  return (
    <main className="page recommendations-page">
      <section className="collection-heading">
        <div>
          <p className="eyebrow">规则推荐</p>
          <h1>简易推荐</h1>
          <p className="muted">根据分级、复核状态、证据强度和雷点矩阵生成。它不是最终判断，只是帮你先筛出更值得看的条目。</p>
        </div>
      </section>

      <PersonalRecommendationPanel recommendations={allRecommendations} />

      <section className="recommendation-rules detail-card">
        <h2>当前规则</h2>
        <div>
          <span>分级越高，加分越多</span>
          <span>已复核和证据较强会加分</span>
          <span>严重雷点会扣分</span>
          <span>矩阵未填写时只做保守推荐</span>
          <span>个人列表会排除已看和避雷</span>
        </div>
      </section>

      <RecommendationGroup title="优先推荐" description="综合分较高，适合作为优先阅读候选。" works={groups.priority} />
      <RecommendationGroup title="谨慎尝试" description="有可取之处，但仍建议先看简介、材料和雷点矩阵。" works={groups.cautious} />
      <RecommendationGroup title="暂不推荐" description="分级、争议、材料或雷点风险较高，默认不作为推荐。" works={groups.notRecommended} />
    </main>
  )
}
