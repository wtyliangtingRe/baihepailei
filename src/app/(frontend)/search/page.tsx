import SearchClient from './search-client'

export default function SearchPage() {
  return (
    <main className="page search-page">
      <section className="page-heading">
        <p className="eyebrow">Search</p>
        <h1>搜索资料库</h1>
        <p>输入关键词，搜索作品、创作者、名词解释和规则。</p>
      </section>
      <SearchClient />
    </main>
  )
}
