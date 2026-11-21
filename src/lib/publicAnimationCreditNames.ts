import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreditEdge, PublicCreator } from './publicCreatorGraph'

type NameCorrection = {
  workId: string
  oldCreatorId: string
  oldName: string
  role: string
  subject: number
  official?: string
  targets: { creatorId: string; person: number; name: string; scope?: string }[]
}

function key(workId: string, creatorId: string, name: string, role: string) {
  return JSON.stringify([workId, creatorId, name, role])
}

export function readAnimationCreditNames(directory: string, enabled: boolean) {
  const rows = new Map<string, NameCorrection>()
  const redirects = new Map<string, string>()
  if (enabled) {
    const file = join(directory, '..', 'identity-20261121', 'animation-credit-names.json')
    const data: { rows: NameCorrection[]; redirects: Record<string, string> } = JSON.parse(readFileSync(file, 'utf8'))
    for (const [from, to] of Object.entries(data.redirects)) redirects.set(from, to)
    for (const row of data.rows) {
      const id = key(row.workId, row.oldCreatorId, row.oldName, row.role)
      if (rows.has(id) || !Number.isSafeInteger(row.subject) || row.subject < 1 || !row.targets.length)
        throw new Error(`Invalid animation credit correction for ${row.workId}`)
      rows.set(id, row)
    }
  }
  function resolve(edge: CreditEdge, entities: Map<string, PublicCreator>): CreditEdge[] {
    const id = key(edge.workId, edge.creatorId, edge.displayName, edge.role)
    const row = rows.get(id)
    if (!row) return [edge]
    const subjectUrl = `https://bgm.tv/subject/${row.subject}`
    if (edge.creditKind !== 'person' || !edge.sourceUrls.some(url => {
      const source = new URL(url)
      return ['bgm.tv', 'chii.in', 'bangumi.tv'].includes(source.hostname) &&
        [`/subject/${row.subject}`, `/subject/${row.subject}/persons`].includes(source.pathname.replace(/\/$/, ''))
    })) throw new Error(`Animation credit edition changed for ${row.workId}`)
    rows.delete(id)
    return row.targets.map(target => {
      const person = entities.get(target.creatorId)
      if (person?.kind !== 'person' || person.name !== target.name || !Number.isSafeInteger(target.person) || target.person < 1)
        throw new Error(`Unknown animation staff member for ${row.workId}`)
      const sources = [...edge.sourceUrls, `${subjectUrl}/persons`, `https://bgm.tv/person/${target.person}`]
      if (row.official) sources.push(row.official)
      return { ...edge, creatorId: target.creatorId, displayName: target.name, scope: target.scope,
        bindingBasis: 'edition_staff_roster', sourceUrls: [...new Set(sources)] }
    })
  }
  return { redirects, resolve, assertComplete() {
    if (rows.size) throw new Error(`Unmatched animation credit correction: ${rows.keys().next().value}`)
  } }
}
