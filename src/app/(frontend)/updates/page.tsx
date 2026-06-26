import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readDetailIndex, type DetailItem } from '../_lib/detail-index'

const collectionLabels: Record<string, string> = {
  works: '作品',
  creators: '创作者',
  organizations: '机构',
  evidence: '证据材料',
  terms: '名词解释',
  rules: '排雷规则',
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

function collectionLabel(collection: string) {
  return collectionLabels[collection] || collection
}

function reviewStatusLabel(value?: string) {
  if (!value) return ''
  return reviewStatusLabels[value] || value
}

function evidenceStrengthLabel(value?: string) {
  if (!value) return ''
  return evidenceStrengthLabels[value] || value
}

function itemDate(item: DetailItem) {
  return item.updatedAt || item.createdAt || ''
}

function formatDate(value?: string) {
  if (!value) return '暂无时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function updateSummary(item: DetailItem) {
  const pieces = [
    reviewStatusLabel(item.reviewStatus),
    evidenceStrengthLabel(item.evidenceStrength),
    item.status ? `状态：${item.status}` : '',
  ].filter(Boolean)

  return pieces.length ? pieces.join(' / ') : '当前版本暂无额外说明。'
}

export default function UpdatesPage() {
  const index = readDetailIndex()
  if (!index) return <MissingSearchIndex />

  const items = [...index.items]
    .filter((item) => item.url)
    .sort((a, b) => new Date(itemDate(b)).getTime() - new Date(itemDate(a)).getTime())
    .slice(0, 80)

  return (
    <main className="page collection-page updates-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">最近更新</p>
        <h1>最近更新</h1>
        <p>这里展示新站当前 Lite 详情索引中的最近更新条目，用于快速查看哪些资料刚被新增、复核或调整。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/browse">返回资料库</Link>
          <Link className="back-link" href="/search">搜索资料</Link>
          <span>{items.length} 条</span>
        </div>
      </section>

      <section className="updates-list" aria-label="最近更新列表">
        {items.length === 0 ? (
          <section className="empty-state small">
            <h2>暂无更新记录</h2>
            <p>生成 detail-index.json 后，这里会显示最近更新条目。</p>
          </section>
        ) : (
          items.map((item) => (
            <Link className="update-card" href={item.url} key={item.id}>
              <div>
                <span>{collectionLabel(item.collection)}</span>
                <time dateTime={itemDate(item)}>{formatDate(itemDate(item))}</time>
              </div>
              <h2>{item.title}</h2>
              <p>{updateSummary(item)}</p>
            </Link>
          ))
        )}
      </section>
    </main>
  )
}
