import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex } from '../_lib/search-index'

const links = [
  ['works', 'Works'],
  ['creators', 'Creators'],
  ['terms', 'Terms'],
  ['rules', 'Rules'],
]

export default function BrowsePage() {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  return (
    <main className="page">
      <section className="page-heading">
        <p className="eyebrow">browse</p>
        <h1>Browse</h1>
        <p>{index.total} indexed entries</p>
      </section>

      <section className="results-list">
        {links.map(([kind, label]) => (
          <article className="result-card" key={kind}>
            <div className="result-card-header">
              <p>{index.counts[kind] || 0} entries</p>
            </div>
            <h2>{label}</h2>
            <Link className="result-link" href={`/${kind}`}>/{kind}</Link>
          </article>
        ))}
      </section>
    </main>
  )
}
