import Link from 'next/link'

export type StewardshipNoticeView = {
  id?: string | number
  slug?: string
  title?: string
  summary?: string
  category?: string
  tone?: string
  severity?: string
  helpUrl?: string
  sortOrder?: number
}

type NoticeItem = {
  stewardshipNotices?: Array<StewardshipNoticeView | string | number>
}

const categoryLabels: Record<string, string> = {
  operation: '站务状态',
  terminology: '用语解释',
  identity: '身份与版本',
  editorial: '编辑与裁量',
  content: '内容警示',
  transparency: '透明度说明',
  other: '站务提示',
}

const severityLabels: Record<string, string> = {
  low: '提示',
  medium: '注意',
  high: '重要',
  critical: '关键',
}

function normalizedNotices(item: NoticeItem) {
  return (item.stewardshipNotices || [])
    .filter((notice): notice is StewardshipNoticeView => Boolean(notice && typeof notice === 'object'))
    .filter((notice) => Boolean(String(notice.title || '').trim() || String(notice.summary || '').trim()))
    .sort((left, right) => Number(left.sortOrder || 100) - Number(right.sortOrder || 100))
}

export default function StewardshipNoticeBlock({ item }: { item: NoticeItem }) {
  const notices = normalizedNotices(item)
  if (!notices.length) return null

  return (
    <section className="detail-card stewardship-notice-block" aria-label="站务与用语">
      <header className="rank-group-heading stewardship-notice-heading">
        <div>
          <p className="eyebrow">站务与用语</p>
          <h2>阅读本条目前请注意</h2>
        </div>
      </header>
      <div className="collection-grid collection-grid-compact notice-template-grid stewardship-notice-list">
        {notices.map((notice, index) => {
          const tone = String(notice.tone || 'note')
          const title = String(notice.title || '站务提示')
          const key = String(notice.id || notice.slug || `${title}-${index}`)
          return (
            <article className="collection-card collection-card-compact notice-template-card stewardship-notice" data-severity={notice.severity || 'low'} data-tone={tone} key={key}>
              <div className="notice-template-copy stewardship-notice-copy">
                <p>{categoryLabels[notice.category || ''] || '站务提示'} · {severityLabels[notice.severity || ''] || '提示'}</p>
                <h2>{title}</h2>
                {notice.summary ? <span>{notice.summary}</span> : null}
                {notice.helpUrl ? <Link href={notice.helpUrl}>查看进一步说明</Link> : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
