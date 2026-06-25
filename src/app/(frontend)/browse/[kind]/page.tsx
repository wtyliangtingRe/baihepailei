import Link from 'next/link'
import { notFound } from 'next/navigation'

import MissingSearchIndex from '../../_components/MissingSearchIndex'
import { readSearchIndex } from '../../_lib/search-index'

type PageArgs = {
  params: Promise<{ kind: string }>
}

const kinds = ['works', 'creators', 'terms', 'rules']

export default async function Page({ params }: PageArgs) {
  const { kind } = await params
  if (!kinds.includes(kind)) notFound()

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const items = index.items.filter((item) => item.collection === kind)

  return (
    <main className="page">
      <section className="page-heading">
        <p className="eyebrow">browse</p>
        <h1>{kind}</h1>
        <p>{items.length} entries</p>
        <div className="actions">
          <Link href="/search">Search</Link>
          <Link href="/browse/works">Works</Link>
          <Link href="/browse/creators">Creators</Link>
          <Link href="/browse/terms">Terms</Link>
          <Link href="/browse/rules">Rules</Link>
        </div>
      </section>

      <section className="results-list">
        {items.map((item) => (
          <article className="result-card" key={item.id}>
            <h2>{item.title}</h2>
            <Link className="result-link" href={item.url}>{item.url}</Link>
          </article>
        ))}
      </section>
    </main>
  )
}
