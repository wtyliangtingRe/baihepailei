import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">Baihepailei Lite</p>
        <h1>百合作品排雷资料库</h1>
        <p>
          这里会重做为结构化资料站：作品、创作者、名词解释和排雷规则都在 Payload 后台维护，前台优先提供轻量文字浏览与快速搜索。
        </p>
        <div className="actions">
          <Link href="/search">开始搜索</Link>
          <Link href="/admin">进入后台</Link>
        </div>
      </section>
    </main>
  )
}
