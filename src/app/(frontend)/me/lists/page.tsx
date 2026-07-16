import Link from 'next/link'

import MyListsClient from '../../_components/MyListsClient'

export default function MyListsPage() {
  return (
    <main className="page my-lists-page">
      <section className="collection-heading">
        <div>
          <p className="eyebrow">个人中心</p>
          <h1>我的列表</h1>
          <p className="muted">管理想看、在看、已看、喜欢、避雷和需要复核的作品。列表与私人备注不会公开。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/account">我的账户</Link>
          <Link className="back-link" href="/works">继续找作品</Link>
        </div>
      </section>
      <MyListsClient />
    </main>
  )
}
