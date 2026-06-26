import Link from 'next/link'

import { readDetailIndex, type DetailItem } from '../_lib/detail-index'
import WorkListControl from './WorkListControl'

type WorkConclusionItem = DetailItem & {
  reviewStatus?: string
  evidenceStrength?: string
  organizations?: string[]
}

const reviewStatusLabels: Record<string, string> = {
  pending: '待复核',
  reviewed: '已复核',
  disputed: '有争议',
  deprecated: '已废弃',
}

const evidenceStrengthLabels: Record<string, string> = {
  unassessed: '未评估',
  weak: '证据弱',
  medium: '证据中',
  strong: '证据强',
}

function displayRank(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function reviewStatusLabel(value?: string) {
  if (!value) return '未标注'
  return reviewStatusLabels[value] || value
}

function evidenceStrengthLabel(value?: string) {
  if (!value) return '未评估'
  return evidenceStrengthLabels[value] || value
}

function normalized(value: string) {
  return value.trim().toLowerCase()
}

function detailTarget(collection: string, value: string) {
  const index = readDetailIndex()
  if (!index) return null
  const key = normalized(value)
  if (!key) return null
  return index.items.find((item) => item.collection === collection && normalized(item.title) === key) || null
}

function LinkedNames({ collection, names }: { collection: 'creators' | 'organizations'; names?: string[] }) {
  const values = (names || []).filter(Boolean)
  if (values.length === 0) return <span>暂无</span>

  return (
    <span className="work-conclusion-links">
      {values.map((name, index) => {
        const target = detailTarget(collection, name)
        return (
          <span key={name}>
            {index > 0 ? <span className="work-conclusion-separator">/</span> : null}
            {target ? <Link href={target.url}>{name}</Link> : <span>{name}</span>}
          </span>
        )
      })}
    </span>
  )
}

function conclusionText(item: WorkConclusionItem, relatedEvidenceCount: number) {
  const rank = displayRank(item.rank)
  const review = reviewStatusLabel(item.reviewStatus)
  const strength = evidenceStrengthLabel(item.evidenceStrength)
  const material = relatedEvidenceCount > 0 || item.hasEvidence ? '已有材料留存' : '暂无材料留存'

  return `当前结论：${rank}。复核状态：${review}；证据强度：${strength}；${material}。`
}

export default function WorkConclusionCard({ item, relatedEvidence = [] }: { item: DetailItem; relatedEvidence?: DetailItem[] }) {
  if (item.collection !== 'works') return null

  const work = item as WorkConclusionItem
  const materialCount = relatedEvidence.length

  return (
    <section className="detail-card work-conclusion-card" aria-label="作品结论">
      <div className="work-conclusion-head">
        <p className="eyebrow">先看结论</p>
        <h2>{conclusionText(work, materialCount)}</h2>
      </div>

      <div className="work-conclusion-grid">
        <div>
          <span>等级</span>
          <strong>{displayRank(work.rank)}</strong>
        </div>
        <div>
          <span>复核状态</span>
          <strong>{reviewStatusLabel(work.reviewStatus)}</strong>
        </div>
        <div>
          <span>证据强度</span>
          <strong>{evidenceStrengthLabel(work.evidenceStrength)}</strong>
        </div>
        <div>
          <span>材料留存</span>
          <strong>{materialCount > 0 || work.hasEvidence ? `${Math.max(materialCount, 1)} 条` : '暂无'}</strong>
        </div>
      </div>

      <dl className="work-conclusion-meta">
        <div>
          <dt>创作者</dt>
          <dd><LinkedNames collection="creators" names={work.creators} /></dd>
        </div>
        <div>
          <dt>相关机构</dt>
          <dd><LinkedNames collection="organizations" names={work.organizations} /></dd>
        </div>
      </dl>

      <WorkListControl item={item} />
    </section>
  )
}
