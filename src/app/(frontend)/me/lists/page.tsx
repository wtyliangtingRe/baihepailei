import MyListsClient from '../../_components/MyListsClient'

export default function MyListsPage() {
  return (
    <main className="page my-lists-page">
      <section className="collection-heading">
        <div>
          <p className="eyebrow">个人中心</p>
          <h1>我的列表</h1>
          <p className="muted">查看你标记为想看、已看、避雷和需要复核的作品。列表记录不会公开展示。</p>
        </div>
      </section>

      <MyListsClient />
    </main>
  )
}
