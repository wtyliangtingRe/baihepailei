import Link from 'next/link'

export default function MissingSearchIndex() {
  return (
    <main className="page detail-page">
      <section className="empty-state">
        <h1>还没有可用的搜索索引</h1>
        <p>请先生成 public/search-index.json，然后重新打开页面。</p>
        <pre>pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts</pre>
        <div className="actions">
          <Link href="/search">返回搜索</Link>
          <Link href="/admin">进入后台</Link>
        </div>
      </section>
    </main>
  )
}
