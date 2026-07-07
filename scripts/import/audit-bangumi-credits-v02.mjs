#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-credits-audit-v0.2'
const ROOTS = ['data_local/raw/bangumi', 'E:/data/baihepailei/data_local/raw/bangumi']
const AUDIT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'

const CREATOR = new Map([
  ['原作', 'original_creator'], ['原作者', 'original_creator'], ['作者', 'original_creator'], ['漫画', 'original_creator'], ['監修', 'original_creator'],
  ['原案', 'original_concept'], ['企画原案', 'original_concept'], ['企划原案', 'original_concept'],
  ['导演', 'director'], ['監督', 'director'], ['监督', 'director'], ['动画导演', 'director'],
  ['总监督', 'chief_director'], ['総監督', 'chief_director'], ['总导演', 'chief_director'],
  ['系列监督', 'series_director'], ['系列監督', 'series_director'],
  ['系列构成', 'series_composition'], ['系列構成', 'series_composition'],
  ['脚本', 'script'], ['剧本', 'script'], ['劇本', 'script'], ['シナリオ', 'script'],
  ['人物原案', 'character_original_design'], ['角色原案', 'character_original_design'], ['キャラクター原案', 'character_original_design'],
  ['人物设定', 'character_design'], ['角色设计', 'character_design'], ['人设', 'character_design'], ['キャラクターデザイン', 'character_design'],
  ['制片人', 'producer'], ['制作人', 'producer'], ['プロデューサー', 'producer'], ['动画制片人', 'producer'], ['总制片人', 'producer'], ['副制片人', 'producer'], ['助理制片人', 'producer'],
])
const ORG = new Map([
  ['出版社', 'publisher'], ['出版', 'publisher'], ['连载杂志', 'publisher'], ['連載雑誌', 'publisher'], ['掲載誌', 'publisher'], ['书系', 'publisher'], ['图书品牌', 'publisher'],
  ['动画制作', 'animation_studio'], ['動畫制作', 'animation_studio'], ['アニメーション制作', 'animation_studio'],
  ['开发', 'game_developer'], ['開発', 'game_developer'], ['开发商', 'game_developer'], ['游戏开发', 'game_developer'], ['游戏开发商', 'game_developer'], ['制作廠商', 'game_developer'], ['製作廠商', 'game_developer'],
  ['发行', 'distributor'], ['发行商', 'distributor'], ['代理发行', 'distributor'], ['發行', 'distributor'], ['配给', 'distributor'], ['配給', 'distributor'], ['発売', 'distributor'],
  ['平台', 'platform'], ['播放平台', 'streaming_platform'], ['在线播放平台', 'streaming_platform'], ['网络播放', 'streaming_platform'], ['播放网站', 'streaming_platform'],
  ['播放电视台', 'broadcaster'], ['其他电视台', 'broadcaster'], ['电视台', 'broadcaster'], ['放送局', 'broadcaster'],
  ['制作委员会', 'committee'], ['製作委員会', 'committee'], ['制作委员会成员', 'committee_member'],
  ['音乐制作', 'music_label'], ['音楽制作', 'music_label'], ['厂牌', 'music_label'], ['品牌', 'brand'], ['社团', 'circle'], ['サークル', 'circle'],
  ['製作', 'production_company'], ['制作', 'production_company'], ['制作协力', 'production_company'], ['製作协力', 'production_company'], ['制作協力', 'production_company'],
])
const BAD_KEY = /日期|日$|时间|開始|开始|结束|結束|发售|発売|价格|售价|话数|页数|册数|片长|时长|ISBN|ASIN|CERO|官网|官方网站|website|Website|链接|Twitter|Steam|steam|IMDb|imdb|Copyright|copyright|备注|状态|类型|游戏类型|游玩人数|语言|分级/
const BAD_VALUE = /^(\d{4}([-/.]\d{1,2}){0,2}|\d+|unknown|N\/A)$/i

function clean(v) { return String(v ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() }
function mojibake(v) { const s = clean(v); const n = (s.match(/[ÃÂãäåæçèéêëìíîïðñòóôõöøùúûüýþ�]/g) || []).length; return n >= 3 && n / Math.max(1, s.length) > 0.08 }
function walk(d, out = []) { if (!fs.existsSync(d)) return out; for (const x of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, x.name); if (x.isDirectory()) walk(f, out); else if (/\.(json|jsonl|ndjson)$/i.test(x.name)) out.push(f) } return out }
async function* readRows(file) { if (/\.(jsonl|ndjson)$/i.test(file)) { const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity }); for await (const line of rl) { if (!line.trim()) continue; try { yield JSON.parse(line) } catch {} } return } const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return; let j; try { j = JSON.parse(raw) } catch { return } if (Array.isArray(j)) { for (const x of j) yield x; return } for (const k of ['data','items','subjects','docs','results','records']) if (Array.isArray(j?.[k])) { for (const x of j[k]) yield x; return } yield j }
function unwrap(v, out = []) { if (!v || typeof v !== 'object') return out; if (Array.isArray(v)) { for (const x of v) unwrap(x, out); return out } if (('id' in v || 'subject_id' in v || 'subjectId' in v) && ('name' in v || 'name_cn' in v || 'infobox' in v)) out.push(v); for (const k of ['raw','subject','candidate','data','item']) if (v[k]) unwrap(v[k], out); return out }
function values(v, out = []) { if (v == null) return out; if (typeof v === 'string' || typeof v === 'number') { const s = clean(v); if (s) out.push(s); return out } if (Array.isArray(v)) { for (const x of v) values(x, out); return out } if (typeof v === 'object') for (const k of ['v','value','name','title','text','label']) if (k in v) values(v[k], out); return out }
function splitNames(s) { return clean(s).split(/\s*(?:、|，|,|；|;|／|\/|\+| and |&|＆)\s*/i).map((x) => clean(x.replace(/^\[[^\]]+\]/, '').replace(/\([^)]{1,60}\)$/,'').replace(/（[^）]{1,60}）$/,''))).filter(Boolean) }
function validName(s, isOrg) { const v = clean(s); if (!v || v.length > 80 || mojibake(v) || BAD_VALUE.test(v) || /https?:\/\//i.test(v)) return false; if (!isOrg && /委員会|委员会|製作|制作会社|株式会社|社|テレビ|TV|Studio|スタジオ|出版社/.test(v)) return false; return true }
function readJsonl(f) { if (!fs.existsSync(f)) return []; const raw = fs.readFileSync(f, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function add(map, row) { const key = [row.workId, row.name, row.role, row.originalRole].map((x) => clean(x).toLowerCase()).join('|'); if (!map.has(key)) map.set(key, row) }

const args = Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2), a[i+1]?.startsWith('--') ? true : a[i+1] ?? true]:null).filter(Boolean))
const roots = String(args.roots || '').split(';').map(clean).filter(Boolean)
const scanRoots = (roots.length ? roots : ROOTS).filter((r) => fs.existsSync(r))
const outDir = String(args['out-dir'] || OUT)
const audit = readJsonl(String(args.audit || AUDIT))
const byBgm = new Map()
for (const row of audit) { const id = clean(row.bangumiId); const works = (row.matchedWorks || []).filter((w) => clean(w.match) === 'external_id'); if (id && works.length) byBgm.set(id, works) }
const files = scanRoots.flatMap((r) => walk(r)).filter((f) => /bangumi|bgm|subject/i.test(f)).sort((a,b)=>a.localeCompare(b))
const creator = new Map(), org = new Map(), skipped = []
let rawRows = 0, subjectsRead = 0, subjectsMatched = 0
for (const file of files) for await (const wrapper of readRows(file)) { rawRows += 1; for (const rec of unwrap(wrapper)) { subjectsRead += 1; const id = clean(rec.id || rec.subject_id || rec.subjectId || rec.bangumiSubjectId); const works = byBgm.get(id) || []; if (!works.length) continue; subjectsMatched += 1; for (const info of Array.isArray(rec.infobox) ? rec.infobox : []) { const key = clean(info?.key || info?.k || info?.label); if (!key || BAD_KEY.test(key) || mojibake(key)) { skipped.push({ bangumiId:id, key, reason:'bad_or_non_credit_key' }); continue } const cRole = CREATOR.get(key); const oRole = ORG.get(key); if (!cRole && !oRole) { skipped.push({ bangumiId:id, key, reason:'unmapped_key' }); continue } const rawNames = values(info?.value ?? info?.v); for (const rawName of rawNames) for (const name of splitNames(rawName)) { if (cRole && validName(name, false)) for (const w of works) add(creator, { workId: clean(w.id), workTitle: clean(w.title), bangumiId:id, name, role:cRole, originalRole:key, source:'bangumi' }); else if (cRole) skipped.push({ bangumiId:id, key, value:name, reason:'invalid_creator_name' }); if (oRole && validName(name, true)) for (const w of works) add(org, { workId: clean(w.id), workTitle: clean(w.title), bangumiId:id, name, role:oRole, originalRole:key, source:'bangumi' }); else if (oRole) skipped.push({ bangumiId:id, key, value:name, reason:'invalid_organization_name' }) } } } }
const creators = [...creator.values()], orgs = [...org.values()]
const outputs = { creators: path.join(outDir, 'bangumi-credits-v02-creators.jsonl'), organizations: path.join(outDir, 'bangumi-credits-v02-organizations.jsonl'), skipped: path.join(outDir, 'bangumi-credits-v02-skipped.jsonl'), summary: path.join(outDir, 'bangumi-credits-v02-summary.json'), samples: path.join(outDir, 'bangumi-credits-v02-samples.json') }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, ok: true, scanRoots, filesScanned: files.length, rawRows, subjectsRead, matchedBangumiIds: byBgm.size, subjectsMatched, creatorCreditRows: creators.length, organizationCreditRows: orgs.length, creatorNames: new Set(creators.map((x)=>x.name.toLowerCase())).size, organizationNames: new Set(orgs.map((x)=>x.name.toLowerCase())).size, worksWithCreatorCredits: new Set(creators.map((x)=>x.workId)).size, worksWithOrganizationCredits: new Set(orgs.map((x)=>x.workId)).size, skippedRows: skipped.length, byCreatorRole: count(creators,'role'), byOrganizationRole: count(orgs,'role'), bySkippedReason: count(skipped,'reason'), bySkippedKey: count(skipped,'key'), outputs, safety: { readOnly:true, payloadRead:false, payloadWrite:false, directPostgresqlWrite:false, dataChanged:false } }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.creators, creators.map((x)=>JSON.stringify(x)).join('\n') + (creators.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.organizations, orgs.map((x)=>JSON.stringify(x)).join('\n') + (orgs.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.skipped, skipped.map((x)=>JSON.stringify(x)).join('\n') + (skipped.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outputs.samples, JSON.stringify({ creators: creators.slice(0, 80), organizations: orgs.slice(0, 80), skipped: skipped.slice(0, 80) }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
