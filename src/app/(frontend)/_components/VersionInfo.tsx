import Link from 'next/link'

import type { DetailItem } from '../_lib/detail-index'

function formatDate(value?: string) {
  if (!value) return ''
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

export default function VersionInfo({ item }: { item: DetailItem }) {
  const updatedAt = formatDate(item.updatedAt)
  const createdAt = formatDate(item.createdAt)

  if (!updatedAt && !createdAt) return null

  return (
    <section className="page version-note-shell" aria-label="版本说明">
      <div className="detail-card version-note">
        <h2>版本说明</h2>
        {updatedAt ? <p>最近更新：{updatedAt}</p> : null}
        {createdAt ? <p>创建时间：{createdAt}</p> : null}
        <p className="muted">这里只展示新站当前条目的时间信息。更完整的站内更新列表可查看最近更新页。</p>
        <Link className="back-link" href="/updates">查看最近更新</Link>
      </div>
    </section>
  )
}
