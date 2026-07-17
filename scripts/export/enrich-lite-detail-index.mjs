#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_SEARCH = 'public/search-index.json'
const DEFAULT_DETAIL = 'public/detail-index.json'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Missing file: ${resolved}`)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function compactFields(item) {
  const copy = { ...item }
  delete copy.legacyXWikiPage
  return copy
}

function detailsFromSearchItem(item) {
  return compactFields({
    id: item.id,
    recordId: item.recordId,
    collection: item.collection,
    typeLabel: item.typeLabel,
    title: item.title,
    slug: item.slug,
    url: item.url,
    rank: item.rank,
    reviewStatus: item.reviewStatus,
    reviewOrigin: item.reviewOrigin,
    evidenceStrength: item.evidenceStrength,
    ratingNotice: item.ratingNotice,
    reviewReasons: item.reviewReasons,
    radarAssessment: item.radarAssessment,
    researchPreview: item.researchPreview,
    category: item.category,
    organizationType: item.organizationType,
    evidenceType: item.evidenceType,
    originalTitle: item.originalTitle,
    aliases: item.aliases,
    creators: item.creators,
    organizations: item.organizations,
    relatedWorks: item.relatedWorks,
    relatedCreators: item.relatedCreators,
    relatedOrganizations: item.relatedOrganizations,
    tags: item.tags,
    warnings: item.warnings,
    riskMatrix: item.riskMatrix,
    relatedTerms: item.relatedTerms,
    relatedWarnings: item.relatedWarnings,
    cover: item.cover,
    image: item.image,
    sections: [],
  })
}

function mergeDetailItem(detailItem, searchItem) {
  if (!searchItem) return compactFields(detailItem)

  return compactFields({
    ...detailItem,
    recordId: searchItem.recordId || detailItem.recordId,
    url: searchItem.url || detailItem.url,
    organizationType: searchItem.organizationType || detailItem.organizationType,
    evidenceType: searchItem.evidenceType || detailItem.evidenceType,
    reviewStatus: searchItem.reviewStatus || detailItem.reviewStatus,
    reviewOrigin: searchItem.reviewOrigin || detailItem.reviewOrigin,
    evidenceStrength: searchItem.evidenceStrength || detailItem.evidenceStrength,
    ratingNotice: searchItem.ratingNotice || detailItem.ratingNotice,
    reviewReasons: searchItem.reviewReasons || detailItem.reviewReasons,
    radarAssessment: searchItem.radarAssessment || detailItem.radarAssessment,
    researchPreview: searchItem.researchPreview || detailItem.researchPreview,
    organizations: searchItem.organizations || detailItem.organizations,
    relatedWorks: searchItem.relatedWorks || detailItem.relatedWorks,
    relatedCreators: searchItem.relatedCreators || detailItem.relatedCreators,
    relatedOrganizations: searchItem.relatedOrganizations || detailItem.relatedOrganizations,
    riskMatrix: searchItem.riskMatrix || detailItem.riskMatrix,
    cover: searchItem.cover || detailItem.cover,
    image: searchItem.image || detailItem.image,
  })
}

function countByCollection(items) {
  return items.reduce((counts, item) => {
    counts[item.collection] = (counts[item.collection] || 0) + 1
    return counts
  }, {})
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const searchFile = String(args.search || DEFAULT_SEARCH)
  const detailFile = String(args.detail || DEFAULT_DETAIL)
  const outFile = String(args.out || detailFile)

  const searchIndex = readJson(searchFile)
  const detailIndex = readJson(detailFile)

  const searchById = new Map((searchIndex.items || []).map((item) => [item.id, item]))
  const detailById = new Map((detailIndex.items || []).map((item) => [item.id, item]))

  const mergedItems = (detailIndex.items || []).map((item) => mergeDetailItem(item, searchById.get(item.id)))

  for (const item of searchIndex.items || []) {
    if (!detailById.has(item.id) && ['organizations', 'evidence'].includes(item.collection)) {
      mergedItems.push(detailsFromSearchItem(item))
    }
  }

  const payload = {
    ...detailIndex,
    schemaVersion: Math.max(Number(detailIndex.schemaVersion || 1), 3),
    counts: countByCollection(mergedItems),
    total: mergedItems.length,
    items: mergedItems,
  }

  writeJson(outFile, payload)
  console.log('Lite detail index enriched')
  console.log(JSON.stringify({ out: path.resolve(outFile), counts: payload.counts, total: payload.total }, null, 2))
}

main()
