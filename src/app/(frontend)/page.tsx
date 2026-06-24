import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">Baihepailei</p>
        <h1>白河排列新站开发中</h1>
        <p>
          这里会重做为结构化资料站：条目、创作者、术语、标签和规则都会在后台维护，前台负责浏览、搜索和筛选。
        </p>
        <div className="actions">
          <Link href="/admin">进入后台</Link>
          <Link href="/api/entries">查看 Entries API</Link>
        </div>
      </section>
    </main>
  )
}
