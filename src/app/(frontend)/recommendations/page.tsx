import Link from 'next/link'

import AssessmentOriginBadge from '../_components/AssessmentOriginBadge'
import PersonalRecommendationPanel from '../_components/PersonalRecommendationPanel'
import { readDetailIndex } from '../_lib/detail-index'
import { recommendedWorks, recommendationsByBucket, type RecommendedWork } from '../_lib/recommendations'

const reasonLabels: Record<string, string> = {
  'rank-good': '分级较高', 'rank-mid': '分级中等', 'rank-risk': '分级风险较高', blacklist: '黑名单 / 高危',
  reviewed: '人工已复核', disputed: '存在争议', deprecated: '已废弃', 'ai-pending': 'AI 综合待复核',
  'information-insufficient': '信息不足', 'human-review-required': '仍需人工复核', 'evidence-ok': '证据较充分',
  'evidence-present': '已有材料', 'evidence-missing': '材料不足', 'confidence-high': '判断置信度较高',
  'confidence-low': '判断置信度偏低', 'coverage-high': '资料覆盖较高', 'coverage-low': '资料覆盖偏低',
  'matrix-missing': '矩阵未填写', 'male-none': '男性影响低', 'male-severe': '男性影响严重',
  'relationship-confirmed': '关系明确', 'relationship-friendship': '友情向风险', 'ending-safe': '结局安全',
  'ending-bad': '结局明确雷', 'creator-severe': '创作者风险严重',
}

const mediaGroupLabels: Record<string, string> = { anime: '动画', manga: '漫画', novel: '小说', game: '游戏', other: '其他', unknown: '未知类型' }
const formatLabels: Record<string, string> = {
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: '网络动画', manga_series: '漫画连载',
  manga_oneshot: '漫画短篇', novel_series: '小说系列', light_novel_series: '轻小说系列', web_serial: 'Web 连载',
  visual_novel: '视觉小说', pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏',
  audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon_series: 'Webtoon 连载', doujin: '同人作品', anthology: '合集 / 选集',
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  return rank === 'AA' ? 'S级' : `${rank}级`
}

function typeLabel(work: RecommendedWork) {
  return formatLabels[work.item.format || ''] || mediaGroupLabels[work.item.mediaGroup || 'unknown'] || '未知类型'
}

function RecommendationCard({ work }: { work: RecommendedWork }) {
  return (
    <Link className="recommendation-card" href={work.item.url}>
      <div className="recommendation-card-meta"><span>{rankLabel(work.item.rank)}</span><span>{typeLabel(work)}</span><span>{work.score} 分</span><AssessmentOriginBadge item={work.item} /></div>
      <h3>{work.item.title}</h3>
      {work.item.originalTitle ? <p>{work.item.originalTitle}</p> : null}
      <ul>{work.reasonCodes.slice(0, 6).map((code) => <li key={code}>{reasonLabels[code] || code}</li>)}</ul>
    </Link>
  )
}

function RecommendationGroup({ title, description, works }: { title: string; description: string; works: RecommendedWork[] }) {
  return (
    <section className="recommendation-section">
      <div className="collection-heading"><div><p className="eyebrow">{works.length} 个作品</p><h2>{title}</h2><p className="muted">{description}</p></div></div>
      {works.length === 0 ? <p className="muted">暂无作品进入这一组。</p> : <div className="recommendation-grid">{works.slice(0, 12).map((work) => <RecommendationCard key={work.item.id} work={work} />)}</div>}
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
      <section className="collection-heading"><div><p className="eyebrow">可解释推荐</p><h1>推荐</h1><p className="muted">根据正式分级、人工复核、页面提示、证据强度、资料覆盖和雷点矩阵生成。每张卡都会说明入选或降级原因；推荐只是筛选参考，不代替条目结论。</p></div></section>
      <PersonalRecommendationPanel recommendations={allRecommendations} />
      <section className="recommendation-rules detail-card"><h2>当前规则</h2><div><span>只有人工已复核条目可进入优先推荐</span><span>AI 综合待复核最多进入谨慎尝试</span><span>证据和资料覆盖会影响排序</span><span>X / F 与争议条目默认不推荐</span><span>个人列表排除已看和避雷</span></div></section>
      <RecommendationGroup title="优先推荐" description="人工已复核、证据与风险信息较充分，适合作为优先阅读候选。" works={groups.priority} />
      <RecommendationGroup title="谨慎尝试" description="有可取之处，但仍需先看页面提示、材料和雷点矩阵。" works={groups.cautious} />
      <RecommendationGroup title="暂不推荐" description="分级、争议、资料不足或雷点风险较高，默认不作为推荐。" works={groups.notRecommended} />
    </main>
  )
}
