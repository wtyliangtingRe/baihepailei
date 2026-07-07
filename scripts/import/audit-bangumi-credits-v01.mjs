#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-credits-audit-v0.1'
const DEFAULT_ROOTS = ['data_local/raw/bangumi', 'E:/data/baihepailei/data_local/raw/bangumi']
const AUDIT_ROWS = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'

const CREATOR_RULES = [
  [/原作|原作者|作者|漫画作者|作画|插画|監修/i, 'original_creator'],
  [/原案|企画原案/i, 'original_concept'],
  [/总监督|總監督|総監督|chief director/i, 'chief_director'],
  [/系列监督|系列監督|シリーズディレクター/i, 'series_director'],
  [/监督|監督|导演|導演|director/i, 'director'],
  [/系列构成|系列構成|シリーズ構成/i, 'series_composition'],
  [/脚本|劇本|剧本|scenario|screenplay/i, 'script'],
  [/角色原案|人物原案|キャラクター原案/i, 'character_original_design'],
  [/角色设计|角色設定|人物设定|人设|キャラクターデザイン/i, 'character_design'],
  [/制作人|制片人|producer|プロデューサー/i, 'producer'],
]
const ORG_RULES = [
  [/动画制作|動畫制作|アニメーション制作|animation production/i, 'animation_studio'],
  [/游戏开发|遊戲開發|开发|開發|developer/i, 'game_developer'],
  [/出版社|出版|掲載誌|连载杂志|連載雑誌/i, 'publisher'],
  [/发行|發行|发行商|发行会社|発売|販売/i, 'distributor'],
  [/平台|platform/i, 'platform'],
  [/播放平台|网络播放|網絡播放|streaming/i, 'streaming_platform'],
  [/电视台|電視台|放送局|broadcaster/i, 'broadcaster'],
  [/制作委员会|製作委員会|製作委员会/i, 'committee'],
  [/委员会成员|委員会成員|委员会|委員会/i, 'committee_member'],
  [/音乐制作|音楽制作|音乐|音樂|music/i, 'music_label'],
  [/制作|製作|制作公司|production/i, 'production_company'],
  [/品牌|brand/i, 'brand'],
  [/社团|社團|circle/i, 'circle'],
]

function clean(value) { return String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function walk(dir, out = []) { if (!fs.existsSync(dir)) return out; for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) walk(full, out); else if (/\.(json|jsonl|ndjson)$/i.test(item.name)) out.push(full) } return out }
async function* readRows(file) { if (/\.(jsonl|ndjson)$/i.test(file)) { const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity }); for await (const line of rl) { const body = line.trim(); if (!body) continue; try { yield JSON.parse(body) } catch {} } return } const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return; let data; try { data = JSON.parse(raw) } catch { return } if (Array.isArray(data)) { for (const x of data) yield x; return } for (const key of ['data','items','subjects','docs','results','records']) { if (Array.isArray(data?.[key])) { for (const x of data[key]) yield x; return } } yield data }
function isSubjectLike(value) { return value && typeof value === 'object' && ('id' in value || 'subject_id' in value || 'subjectId' in value) && ('name' in value || 'name_cn' in value || 'infobox' in value) }
function unwrap(value, out = []) { if (!value || typeof value !== 'object') return out; if (Array.isArray(value)) { for (const x of value) unwrap(x, out); return out } if (isSubjectLike(value)) out.push(value); for (const key of ['raw','subject','candidate','data','item']) if (value[key]) unwrap(value[key], out); return out }
function recordId(r) { return clean(r.id || r.subject_id || r.subjectId || r.bangumiSubjectId) }
function valuesOf(value, out = []) { if (value == null) return out; if (typeof value === 'string' || typeof value === 'number') { const t = clean(value); if (t) out.push(t); return out } if (Array.isArray(value)) { for (const x of value) valuesOf(x, out); return out } if (typeof value === 'object') { for (const key of ['v','value','name','title','text','label','k','native','romaji','english','chinese','japanese','zh','ja','en']) if (key in value) valuesOf(value[key], out) } return out }
function roleOf(key, rules) { const k = clean(key); for (const [re, role] of rules) if (re.test(k)) return role; return '' }
function readJsonl(file) { if (!fs.existsSync(file)) return []; const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function matchedWorks(row) { return (Array.isArray(row.matchedWorks) ? row.matchedWorks : []).filter((w) => clean(w.match) === 'external_id') }
function addUnique(map, row) { const key = [row.workId, row.name, row.role, row.originalRole].map((x) => clean(x).toLowerCase()).join('|'); if (!map.has(key)) map.set(key, row) }

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const roots = String(args.roots || '').split(';').map(clean).filter(Boolean)
const scanRoots = (roots.length ? roots : DEFAULT_ROOTS).filter((root) => fs.existsSync(root))
const outDir = String(args['out-dir'] || OUT)
const auditRows = readJsonl(String(args.audit || AUDIT_ROWS))
const byBgm = new Map()
for (const row of auditRows) { const id = clean(row.bangumiId); const works = matchedWorks(row); if (id && works.length) byBgm.set(id, works) }
const files = scanRoots.flatMap((root) => walk(root)).filter((file) => /bangumi|bgm|subject/i.test(file)).sort((a,b)=>a.localeCompare(b))
const creatorMap = new Map(), orgMap = new Map(), rawRoleRows = []
let rawRows = 0, subjectsRead = 0, subjectsMatched = 0
for (const file of files) {
  for await (const wrapper of readRows(file)) {
    rawRows += 1
    for (const record of unwrap(wrapper)) {
      subjectsRead += 1
      const id = recordId(record)
      const works = byBgm.get(id) || []
      if (!works.length) continue
      subjectsMatched += 1
      for (const row of Array.isArray(record.infobox) ? record.infobox : []) {
        const key = clean(row?.key || row?.k || row?.label)
        if (!key) continue
        const names = [...new Set(valuesOf(row?.value ?? row?.v).map(clean).filter((x) => x && x.length <= 120))]
        if (!names.length) continue
        const creatorRole = roleOf(key, CREATOR_RULES)
        const orgRole = roleOf(key, ORG_RULES)
        rawRoleRows.push({ bangumiId: id, key, count: names.length, creatorRole, orgRole })
        for (const work of works) {
          for (const name of names) {
            if (creatorRole) addUnique(creatorMap, { workId: clean(work.id), workTitle: clean(work.title), bangumiId: id, name, role: creatorRole, originalRole: key, source: 'bangumi' })
            if (orgRole) addUnique(orgMap, { workId: clean(work.id), workTitle: clean(work.title), bangumiId: id, name, role: orgRole, originalRole: key, source: 'bangumi' })
          }
        }
      }
    }
  }
}
const creators = [...creatorMap.values()]
const organizations = [...orgMap.values()]
const outputs = { creators: path.join(outDir, 'bangumi-credits-v01-creators.jsonl'), organizations: path.join(outDir, 'bangumi-credits-v01-organizations.jsonl'), rawRoles: path.join(outDir, 'bangumi-credits-v01-raw-roles.jsonl'), summary: path.join(outDir, 'bangumi-credits-v01-summary.json'), samples: path.join(outDir, 'bangumi-credits-v01-samples.json') }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, ok: true, scanRoots, filesScanned: files.length, rawRows, subjectsRead, matchedBangumiIds: byBgm.size, subjectsMatched, creatorCreditRows: creators.length, organizationCreditRows: organizations.length, creatorNames: new Set(creators.map((x) => x.name.toLowerCase())).size, organizationNames: new Set(organizations.map((x) => x.name.toLowerCase())).size, worksWithCreatorCredits: new Set(creators.map((x) => x.workId)).size, worksWithOrganizationCredits: new Set(organizations.map((x) => x.workId)).size, byCreatorRole: count(creators, 'role'), byOrganizationRole: count(organizations, 'role'), byRawRoleKey: count(rawRoleRows, 'key'), outputs, safety: { readOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false } }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.creators, creators.map((r) => JSON.stringify(r)).join('\n') + (creators.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.organizations, organizations.map((r) => JSON.stringify(r)).join('\n') + (organizations.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.rawRoles, rawRoleRows.map((r) => JSON.stringify(r)).join('\n') + (rawRoleRows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outputs.samples, JSON.stringify({ creators: creators.slice(0, 80), organizations: organizations.slice(0, 80), rawRoleRows: rawRoleRows.slice(0, 80) }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
