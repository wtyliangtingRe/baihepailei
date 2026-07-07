#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'bangumi-credit-entities-plan-v0.1'
const IN_DIR = 'data_local/staging/work-source-metadata'
const CREATOR_IN = `${IN_DIR}/bangumi-credits-v03-creators.jsonl`
const ORG_IN = `${IN_DIR}/bangumi-credits-v03-organizations.jsonl`
const OUT = IN_DIR

function clean(v) { return String(v ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function hash(s) { let h = 5381; for (const ch of clean(s)) h = ((h << 5) + h) ^ ch.codePointAt(0); return (h >>> 0).toString(36).slice(0, 8) }
function slugify(s) { const base = clean(s).toLowerCase().normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|#%&{}$!`'@+=,.;，。！？、（）()\[\]]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return base || 'entity' }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { const v = argv[i]; if (!v.startsWith('--')) continue; const k = v.slice(2), n = argv[i + 1]; if (!n || n.startsWith('--')) out[k] = true; else { out[k] = n; i++ } } return out }
function orgType(role) {
  return ({ publisher:'publisher', production_company:'production_company', animation_studio:'animation_studio', game_developer:'game_company', distributor:'distributor', circle:'circle', brand:'brand', platform:'platform', streaming_platform:'platform', broadcaster:'platform', committee:'committee' })[role] || 'other'
}
function addEntity(map, row, kind) {
  const name = clean(row.name)
  if (!name) return
  const key = name.toLowerCase()
  if (!map.has(key)) map.set(key, { name, roles: new Set(), workIds: new Set(), bangumiIds: new Set(), creditRows: 0, sampleWorks: [] })
  const e = map.get(key)
  e.roles.add(clean(row.role || 'other'))
  if (row.workId) e.workIds.add(String(row.workId))
  if (row.bangumiId) e.bangumiIds.add(String(row.bangumiId))
  e.creditRows += 1
  if (e.sampleWorks.length < 8) e.sampleWorks.push({ workId: row.workId, workTitle: row.workTitle, role: row.role, originalRole: row.originalRole, bangumiId: row.bangumiId })
}

const args = parseArgs(process.argv.slice(2))
const includeOther = Boolean(args['include-other'])
const creatorFile = String(args.creators || CREATOR_IN)
const orgFile = String(args.organizations || ORG_IN)
const outDir = String(args['out-dir'] || OUT)
const creatorRows = readJsonl(creatorFile)
const orgRows = readJsonl(orgFile)
const eligibleCreators = creatorRows.filter((r) => includeOther || clean(r.role) !== 'other')
const eligibleOrgs = orgRows.filter((r) => includeOther || clean(r.role) !== 'other')
const creatorMap = new Map(), orgMap = new Map()
for (const r of eligibleCreators) addEntity(creatorMap, r, 'creator')
for (const r of eligibleOrgs) addEntity(orgMap, r, 'organization')
const creators = [...creatorMap.values()].map((e) => ({ kind:'creator', name:e.name, slug:`creator-${slugify(e.name)}-${hash(e.name)}`, siteId:`bgm-cr-${hash(e.name)}`, rank:'unknown', roles:[...e.roles].sort(), creditRows:e.creditRows, workCount:e.workIds.size, bangumiCount:e.bangumiIds.size, sampleWorks:e.sampleWorks, searchText:[e.name, 'Bangumi credit creator', ...e.roles].join('\n') }))
const organizations = [...orgMap.values()].map((e) => { const roles = [...e.roles].sort(); const type = orgType(roles.find((r) => orgType(r) !== 'other') || roles[0]); return { kind:'organization', name:e.name, slug:`org-${slugify(e.name)}-${hash(e.name)}`, siteId:`bgm-org-${hash(e.name)}`, type, roles, creditRows:e.creditRows, workCount:e.workIds.size, bangumiCount:e.bangumiIds.size, sampleWorks:e.sampleWorks, sourceLinks:[], searchText:[e.name, 'Bangumi credit organization', ...roles].join('\n') } })
const outputs = { creators:path.join(outDir, 'bangumi-credit-entities-v01-creators.jsonl'), organizations:path.join(outDir, 'bangumi-credit-entities-v01-organizations.jsonl'), summary:path.join(outDir, 'bangumi-credit-entities-v01-summary.json'), samples:path.join(outDir, 'bangumi-credit-entities-v01-samples.json') }
const summary = { generatedAt:new Date().toISOString(), version:VERSION, ok:true, includeOther, input:{ creators:creatorFile, organizations:orgFile }, creatorCreditRows:creatorRows.length, organizationCreditRows:orgRows.length, eligibleCreatorCreditRows:eligibleCreators.length, eligibleOrganizationCreditRows:eligibleOrgs.length, skippedCreatorOtherRows:creatorRows.length - eligibleCreators.length, skippedOrganizationOtherRows:orgRows.length - eligibleOrgs.length, plannedCreators:creators.length, plannedOrganizations:organizations.length, byCreatorRole:count(eligibleCreators, 'role'), byOrganizationRole:count(eligibleOrgs, 'role'), byOrganizationType:count(organizations, 'type'), outputs, safety:{ readOnly:true, payloadRead:false, payloadWrite:false, directPostgresqlWrite:false, dataChanged:false } }
fs.mkdirSync(outDir, { recursive:true })
fs.writeFileSync(outputs.creators, creators.map((x)=>JSON.stringify(x)).join('\n') + (creators.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.organizations, organizations.map((x)=>JSON.stringify(x)).join('\n') + (organizations.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outputs.samples, JSON.stringify({ creators:creators.slice(0,80), organizations:organizations.slice(0,80) }, null, 2), 'utf8')
console.log(JSON.stringify({ ok:true, summary, outputs }, null, 2))
