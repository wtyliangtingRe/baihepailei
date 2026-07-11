import SearchClient from './search-client'

export default function SearchPage() {
  return (
    <main className="page search-page">
      <section className="page-heading">
        <p className="eyebrow">搜索</p>
        <h1>搜索资料库</h1>
        <p>输入关键词，搜索作品、创作者和机构。</p>
      </section>
      <SearchClient />
    </main>
  )
}
