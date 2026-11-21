import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreatorKind, CreditEdge } from './publicCreatorGraph'
import type { IdentityReview } from './publicIdentityReview'
import type { PublicWorkRecord } from './publicRelease'

type StaffIdentity = {
  sourceId: string
  person: number
  name: string
  authority: string
}
type Publisher = StaffIdentity & { organizationId: string; organizationName: string; legalName?: string }
type Author = StaffIdentity & { creatorId: string; additionalAuthority: string }
type Correction = StaffIdentity & {
  targetId: string
  targetKind: CreatorKind
  creditName: string
  legalName?: string
  additionalAuthority?: string
}

const editionPublisherRoles = new Set(['原版出版社', '译本出版社', '中文版出版社', '英文版出版社'])

function identities(directory: string): Correction[] {
  const root = join(directory, '..', 'identity-20261121')
  const publishers = JSON.parse(readFileSync(join(root, 'publisher-identities.json'), 'utf8'))
  const authors = JSON.parse(readFileSync(join(root, 'author-identities.json'), 'utf8'))
  if (publishers.schemaVersion !== 'baihepailei-bangumi-publisher-identities-v1' ||
      authors.schemaVersion !== 'baihepailei-bangumi-author-identities-v1') throw new Error('Invalid staff identity review')
  return [
    ...publishers.publishers.map((p: Publisher) => ({ ...p, targetId: p.organizationId, targetKind: 'organization', creditName: p.organizationName })),
    ...authors.authors.map((a: Author) => ({ ...a, targetId: a.creatorId, targetKind: 'person', creditName: a.name })),
  ]
}

export function catalogStaffRedirects(directory: string): Map<string, string> {
  return new Map(identities(directory).filter(row => row.sourceId !== row.targetId).map(row => [row.sourceId, row.targetId]))
}

export function applyCatalogStaffIdentities(directory: string, works: Map<string, PublicWorkRecord>, review: IdentityReview) {
  if (!review) return
  const reviewed = new Map<string, Correction>()
  const entities = new Map(review.entities.map(node => [node.creatorId, node]))
  for (const row of identities(directory)) {
    const { sourceId, person, name, targetId, targetKind, creditName, authority } = row
    const old = entities.get(sourceId)
    if (sourceId !== '815' + String(person).padStart(9, '0') || !old || old.name !== name || old.kind === targetKind ||
        !/^\d{7,12}$/.test(targetId) || !authority.startsWith('https://') || reviewed.has(sourceId)) {
      throw new Error('Staff identity mismatch for ' + sourceId)
    }
    reviewed.set(sourceId, row)
    if (targetId === sourceId) {
      old.kind = targetKind
      old.name = creditName
    } else {
      review.removedCreatorIds.add(sourceId)
    }
    const target = entities.get(targetId)
    if (target) {
      if (target.kind !== targetKind) throw new Error('Conflicting target kind for ' + targetId)
      target.names = [...new Set([...target.names, ...old.names, creditName, ...(row.legalName ? [row.legalName] : [])].filter(Boolean))]
    }
  }
  const matched = new Set<string>()
  for (const [workId, edges] of review.creditsByWork) {
    if (!edges.some(edge => reviewed.has(edge.creatorId))) continue
    const corrected: CreditEdge[] = []
    for (const edge of edges) {
      const row = reviewed.get(edge.creatorId)
      if (!row) { corrected.push(edge); continue }
      if (edge.bindingBasis !== 'bangumi_staff' || edge.creditKind === row.targetKind ||
          !edge.sourceUrls.includes('https://bgm.tv/person/' + row.person) ||
          !edge.sourceUrls.some(url => /^https:\/\/bgm\.tv\/subject\/\d+\/persons$/.test(url))) {
        throw new Error('Unbound staff role for ' + workId + ': ' + edge.creatorId)
      }
      matched.add(edge.creatorId)
      const names = [row.name, row.creditName, row.legalName]
      const existingRole = row.targetKind === 'organization' && edge.role === '出版社' && (
        edges.find(other => other.creditKind === 'organization' && other.creatorId === row.targetId && editionPublisherRoles.has(other.role))?.role ||
        works.get(workId)?.organizations.find(other => names.includes(other.name) && editionPublisherRoles.has(other.role))?.role
      )
      corrected.push({ ...edge, creatorId: row.targetId, creditKind: row.targetKind,
        name: row.creditName, displayName: row.creditName, role: existingRole || edge.role,
        sourceUrls: [...new Set([...edge.sourceUrls, row.authority, ...(row.additionalAuthority ? [row.additionalAuthority] : [])])],
        bindingBasis: row.targetKind === 'person' ? 'author_staff_identity' : 'publisher_staff_identity' })
    }
    review.creditsByWork.set(workId, corrected)
  }
  if (matched.size !== reviewed.size) throw new Error('A reviewed staff identity had no matching edition credit')
}
