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
    <section className="page version-note-shell" aria-label="本条目版本信息">
      <div className="detail-card version-note">
        <h2>本条目版本</h2>
        {updatedAt ? <p>本条目最近更新：{updatedAt}</p> : null}
        {createdAt ? <p>本条目创建时间：{createdAt}</p> : null}
        <p className="muted">以上时间只属于当前作品或资料条目，不是全站更新时间。后续编辑可以据此确认这一个条目何时被修改。</p>
        <Link className="back-link" href="/updates">另看全站最近更新</Link>
      </div>
    </section>
  )
}
