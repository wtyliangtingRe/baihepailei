#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function text(value) {
  return String(value ?? '').trim()
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function readJsonl(file) {
  return readText(file)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
      }
    })
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function meaningful(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function stable(value) {
  if (value === undefined) return '__undefined__'
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}

function countBy(rows, keyFn) {
  const result = {}
  for (const row of rows) {
    const key = text(keyFn(row)) || '<empty>'
    result[key] = (result[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => a[0].localeCompare(b[0])))
}

function identityFieldEntries(row) {
  return Object.entries(row)
    .filter(([key, value]) => /(?:title|slug|original|alias|external|site|source|media|format|published)/iu.test(key) && meaningful(value))
    .sort(([a], [b]) => a.localeCompare(b))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const directory = path.resolve(text(args.directory))
  if (!text(args.directory)) throw new Error('Required: --directory <identity audit directory>')

  const validation = readJson(path.join(directory, 'validation.json'))
  if (validation.jsonValidated !== true) throw new Error('Identity audit JSON validation is not true.')
  if (validation.transport !== 'postgres_utf8_base64_to_powershell_utf8') {
    throw new Error(`Unsupported transport: ${validation.transport}`)
  }
  if (validation.databaseWrite !== false || validation.payloadWrite !== false) {
    throw new Error('Identity audit does not prove read-only safety.')
  }

  const alerts = readJsonl(path.join(directory, 'input-identity-alerts.jsonl'))
  const works = readJsonl(path.join(directory, 'work-rows.jsonl'))
  const related = readJsonl(path.join(directory, 'related-rows.jsonl'))
  const versionRelated = readJsonl(path.join(directory, 'version-related-rows.jsonl'))

  const worksById = new Map(works.map((row) => [Number(row.id), row]))
  const versionToWork = new Map()
  for (const item of related) {
    if (text(item.tableName) !== '_works_v') continue
    const versionId = Number(item?.row?.id)
    const possibleWorkId = Number(
      item?.row?.parent_id
      ?? item?.row?._parent_id
      ?? item?.row?.work_id
      ?? item?.row?.works_id,
    )
    if (Number.isInteger(versionId) && Number.isInteger(possibleWorkId)) {
      versionToWork.set(versionId, possibleWorkId)
    }
  }

  const directRelatedByWork = new Map()
  for (const item of related) {
    const workId = Number(item?.row?.[item.columnName])
    if (!Number.isInteger(workId)) continue
    if (!directRelatedByWork.has(workId)) directRelatedByWork.set(workId, [])
    directRelatedByWork.get(workId).push(item)
  }

  const versionRelatedByWork = new Map()
  for (const item of versionRelated) {
    const versionId = Number(item?.row?.[item.columnName])
    const workId = versionToWork.get(versionId)
    if (!Number.isInteger(workId)) continue
    if (!versionRelatedByWork.has(workId)) versionRelatedByWork.set(workId, [])
    versionRelatedByWork.get(workId).push(item)
  }

  const groups = alerts.map((alert) => {
    const ids = [...new Set((alert.workIds || []).map(Number))].filter(Number.isInteger)
    const rows = ids.map((id) => worksById.get(id)).filter(Boolean)
    const allKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
    const fieldDifferences = []
    const uniqueMeaningfulFields = Object.fromEntries(ids.map((id) => [id, []]))

    for (const key of allKeys) {
      const values = rows.map((row) => row[key])
      if (new Set(values.map(stable)).size > 1) {
        fieldDifferences.push({
          field: key,
          values: Object.fromEntries(rows.map((row) => [row.id, row[key] ?? null])),
        })
      }
      const meaningfulIds = rows.filter((row) => meaningful(row[key])).map((row) => Number(row.id))
      if (meaningfulIds.length === 1) uniqueMeaningfulFields[meaningfulIds[0]].push(key)
    }

    const members = rows.map((row) => {
      const id = Number(row.id)
      const directRows = directRelatedByWork.get(id) || []
      const versionChildren = versionRelatedByWork.get(id) || []
      const versionRows = directRows.filter((item) => text(item.tableName) === '_works_v')
      const ownedRows = directRows.filter((item) => {
        const table = text(item.tableName)
        return table === '_works_v' || table.startsWith('works_')
      })
      const externalInboundRows = directRows.filter((item) => {
        const table = text(item.tableName)
        return table !== '_works_v' && !table.startsWith('works_')
      })

      return {
        id,
        title: row.title ?? null,
        slug: row.slug ?? null,
        createdAt: row.created_at ?? row.createdAt ?? null,
        updatedAt: row.updated_at ?? row.updatedAt ?? null,
        payloadStatus: row._status ?? null,
        catalogStatus: row.catalog_status ?? null,
        nonEmptyPhysicalFields: Object.values(row).filter(meaningful).length,
        identityFields: Object.fromEntries(identityFieldEntries(row)),
        directRowsByTable: countBy(directRows, (item) => `${item.tableSchema}.${item.tableName}`),
        ownedChildRows: ownedRows.length,
        externalInboundReferenceRows: externalInboundRows.length,
        versionRows: versionRows.length,
        versionChildRows: versionChildren.length,
        uniqueMeaningfulFields: uniqueMeaningfulFields[id] || [],
      }
    })

    function leaders(metric) {
      const maximum = Math.max(...members.map((member) => Number(member[metric]) || 0))
      return members.filter((member) => Number(member[metric]) === maximum).map((member) => member.id)
    }

    const latestTime = Math.max(...members.map((member) => Date.parse(member.updatedAt || '') || 0))
    const latestUpdatedIds = members
      .filter((member) => (Date.parse(member.updatedAt || '') || 0) === latestTime)
      .map((member) => member.id)

    return {
      alertId: alert.alertId,
      workIds: ids,
      existingSignals: alert.signals || [],
      canonicalWorkId: null,
      decision: 'manual_full_identity_review_required',
      mergeBlocked: true,
      members,
      fieldDifferences,
      evidenceLeaders: {
        latestUpdatedIds,
        mostNonEmptyPhysicalFields: leaders('nonEmptyPhysicalFields'),
        mostOwnedChildRows: leaders('ownedChildRows'),
        mostExternalInboundReferences: leaders('externalInboundReferenceRows'),
        mostVersionRows: leaders('versionRows'),
      },
      decisionRule: 'Choose a stable canonical Work only after reviewing external IDs, field completeness, inbound references, versions, and merge effects. Newer timestamp alone is insufficient.',
    }
  })

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    identityAlertGroups: groups.length,
    workRows: works.length,
    relatedRows: related.length,
    versionRelatedRows: versionRelated.length,
    groups,
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      canonicalDecisionApplied: false,
      mergePerformed: false,
    },
  }

  writeJson(path.join(directory, 'identity-comparison.json'), summary)

  const markdown = [
    '# Canonical Work identity comparison',
    '',
    'Status: read-only evidence only. No canonical ID was selected and no merge was performed.',
    '',
    ...groups.flatMap((group) => [
      `## ${group.alertId}`,
      '',
      `- Work IDs: ${group.workIds.join(', ')}`,
      `- Field differences: ${group.fieldDifferences.length}`,
      `- Latest updated: ${group.evidenceLeaders.latestUpdatedIds.join(', ')}`,
      `- Most non-empty physical fields: ${group.evidenceLeaders.mostNonEmptyPhysicalFields.join(', ')}`,
      `- Most owned child rows: ${group.evidenceLeaders.mostOwnedChildRows.join(', ')}`,
      `- Most external inbound references: ${group.evidenceLeaders.mostExternalInboundReferences.join(', ')}`,
      `- Most version rows: ${group.evidenceLeaders.mostVersionRows.join(', ')}`,
      '',
      '| Work ID | Title | Updated | Non-empty fields | Owned rows | External refs | Versions |',
      '|---:|---|---|---:|---:|---:|---:|',
      ...group.members.map((member) => `| ${member.id} | ${text(member.title).replaceAll('|', '\\|')} | ${member.updatedAt || ''} | ${member.nonEmptyPhysicalFields} | ${member.ownedChildRows} | ${member.externalInboundReferenceRows} | ${member.versionRows} |`),
      '',
      'Canonical decision remains blocked until the full JSON evidence is reviewed.',
      '',
    ]),
    '## Safety',
    '',
    '- Database write: false',
    '- Payload write: false',
    '- Migration generation: false',
    '- Canonical decision applied: false',
    '- Merge performed: false',
  ].join('\n')
  writeText(path.join(directory, 'identity-comparison.md'), markdown)

  const generated = ['identity-comparison.json', 'identity-comparison.md']
  writeJson(path.join(directory, 'comparison-manifest.json'), generated.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Canonical Work identity comparison complete')
  console.log(`IdentityAlertGroups: ${groups.length}`)
  console.log(`WorkRows: ${works.length}`)
  console.log(`RelatedRows: ${related.length}`)
  console.log(`VersionRelatedRows: ${versionRelated.length}`)
  console.log('')
  console.log('DatabaseWrite: False')
  console.log('PayloadWrite: False')
  console.log('MigrationGeneration: False')
  console.log('CanonicalDecisionApplied: False')
  console.log('MergePerformed: False')
}

main()
