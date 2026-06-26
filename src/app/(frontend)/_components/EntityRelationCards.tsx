import Link from 'next/link'

import type { DetailItem } from '../_lib/detail-index'

type RelationGroup = {
  title: string
  description?: string
  items: DetailItem[]
  emptyText?: string
}

function displayMeta(item: DetailItem) {
  if (item.collection === 'works' && item.rank) return item.rank === 'AA' ? 'S级' : item.rank === 'unknown' ? '未分级' : `${item.rank}级`
  if (item.collection === 'organizations' && item.organizationType) return item.organizationType
  if (item.collection === 'evidence' && item.evidenceType) return item.evidenceType
  return item.typeLabel || item.collection
}

function RelationGroupCards({ group }: { group: RelationGroup }) {
  return (
    <section className="detail-card entity-relation-group">
      <div>
        <h2>{group.title}</h2>
        {group.description ? <p className="muted">{group.description}</p> : null}
      </div>
      {group.items.length ? (
        <div className="entity-relation-list">
          {group.items.map((item) => (
            <Link className="entity-relation-card" href={item.url} key={item.id}>
              <span>{displayMeta(item)}</span>
              <strong>{item.title}</strong>
              {item.originalTitle ? <em>{item.originalTitle}</em> : null}
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">{group.emptyText || '暂无可显示的关联条目。'}</p>
      )}
    </section>
  )
}

export default function EntityRelationCards({ groups }: { groups: RelationGroup[] }) {
  const visibleGroups = groups.filter((group) => group.items.length > 0 || group.emptyText)
  if (visibleGroups.length === 0) return null

  return (
    <section className="page entity-relations" aria-label="条目关联">
      {visibleGroups.map((group) => (
        <RelationGroupCards group={group} key={group.title} />
      ))}
    </section>
  )
}
