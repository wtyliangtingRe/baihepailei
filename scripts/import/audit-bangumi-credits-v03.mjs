#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-credits-audit-v0.3'
const ROOTS = ['data_local/raw/bangumi', 'E:/data/baihepailei/data_local/raw/bangumi']
const AUDIT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'

const CREATOR = new Map(Object.entries({
  '原作':'original_creator','原作者':'original_creator','作者':'original_creator','漫画':'original_creator',
  '原案':'original_concept','企画原案':'original_concept','企划原案':'original_concept',
  '导演':'director','監督':'director','监督':'director','総監督':'chief_director','总监督':'chief_director','总导演':'chief_director',
  '系列监督':'series_director','系列監督':'series_director','系列构成':'series_composition','系列構成':'series_composition',
  '脚本':'script','剧本':'script','劇本':'script','シナリオ':'script',
  '人物原案':'character_original_design','角色原案':'character_original_design','キャラクター原案':'character_original_design',
  '人物设定':'character_design','人物設定':'character_design','角色设计':'character_design','人设':'character_design','キャラクターデザイン':'character_design',
  '制片人':'producer','制作人':'producer','制作プロデューサー':'producer','动画制片人':'producer','总制片人':'producer','副制片人':'producer','助理制片人':'producer','プロデューサー':'producer'
}))
const CREATOR_OTHER = /美术监督|美術監督|摄影监督|撮影監督|音响监督|音響監督|音乐监督|音楽監督|作画监督|作画監督|总作画监督|総作画監督|原画|演出|分镜|絵コンテ|剪辑|編集|色彩设计|色彩設計|美术设计|美術設定|道具设计|机械设定|CG\s*导演|3D.*监督|监督助理|監督補佐|副导演|助监督|动画检查|动画导演|主动画师|美术指导|概念设计|服装设计|怪物设计|设计$/i
const ORG = new Map(Object.entries({
  '出版社':'publisher','出版':'publisher','连载杂志':'publisher','連載雑誌':'publisher','掲載誌':'publisher','书系':'publisher','图书品牌':'publisher',
  '动画制作':'animation_studio','動畫制作':'animation_studio','アニメーション制作':'animation_studio',
  '开发':'game_developer','開発':'game_developer','开发商':'game_developer','游戏开发':'game_developer','游戏开发商':'game_developer','制作廠商':'game_developer','製作廠商':'game_developer',
  '发行':'distributor','发行商':'distributor','代理发行':'distributor','發行':'distributor','配给':'distributor','配給':'distributor','発売':'distributor',
  '平台':'platform','播放平台':'streaming_platform','在线播放平台':'streaming_platform','网络播放':'streaming_platform','播放网站':'streaming_platform',
  '播放电视台':'broadcaster','其他电视台':'broadcaster','电视台':'broadcaster','放送局':'broadcaster',
  '制作委员会':'committee','製作委員会':'committee','制作委员会成员':'committee_member',
  '音乐制作':'music_label','音楽制作':'music_label','厂牌':'music_label','品牌':'brand','社团':'circle','サークル':'circle',
  '製作':'committee','制作':'production_company','制作协力':'production_company','制作協力':'production_company','製作协力':'production_company'
}))
const ORG_OTHER = /宣传|宣伝|协力|協力|特别鸣谢|特别感谢|協賛|赞助|支持|录音工作室|スタジオ|工作室|WEB制作|网站制作|制作进行|制作管理|制作担当|制作主任|制作统括|制作总监|制作协调|发行方|出品方|出品|版权方|著作|版权|运营|营销|推广|商务|法务|财务/i
const BAD_KEY = /中文名|日文名|英文名|别名|話数|话数|官方网站|官网|website|Website|公式|链接|Twitter|ISBN|ASIN|价格|售价|页数|册数|片长|时长|开始|開始|结束|結束|发售日|发售日期|发行日期|放送开始|播放结束|放送星期|上映年度|日期|时间|状态|类型|游戏类型|游玩人数|语言|分级|CERO|Copyright|copyright|备注|来源|简介来源|Steam|steam|IMDb|imdb|imdb_id|FAQ|keyword|标签|形式|结局数|Hシーン|停服|停止|售价|BD发售/
const BAD_VALUE = /^(\d{4}([-/.]\d{1,2}){0,2}|\d+|unknown|N\/A|PC|PS4|PS5|Android|iOS|Windows|Nintendo Switch)$/i

function clean(v){return String(v??'').replaceAll('\r',' ').replaceAll('\n',' ').replace(/\s+/g,' ').trim()}
function mojibake(v){const s=clean(v); const n=(s.match(/[ÃÂãäåæçèéêëìíîïðñòóôõöøùúûüýþ�]/g)||[]).length; return n>=3 && n/Math.max(1,s.length)>0.08}
function stripNotes(s){return clean(s).replace(/\([^)]{0,80}\)/g,'').replace(/（[^）]{0,80}）/g,'').replace(/\[[^\]]{0,80}\]/g,'').replace(/^[^：:]{1,20}[：:]/,'')}
function splitPeople(s){return stripNotes(s).split(/\s*(?:、|，|;|；|\/|／|\+|＆|&| and )\s*/i).map(clean).filter(Boolean)}
function splitOrgs(key,s){const raw=clean(s); if (/製作|制作委员会|製作委員会/.test(key) && /（|\(/.test(raw)) return [clean(raw.replace(/（.*$/,'').replace(/\(.*$/,''))].filter(Boolean); return stripNotes(raw).split(/\s*(?:、|，|;|；|\/|／|\+|＆|&| and |×)\s*/i).map(clean).filter(Boolean)}
function valid(s,isOrg){const v=clean(s); if(!v||v.length>80||mojibake(v)||BAD_VALUE.test(v)||/https?:\/\//i.test(v)) return false; if(!isOrg && /委員会|委员会|製作|制作会社|株式会社|テレビ|TV|Studio|スタジオ|出版社|書店/.test(v)) return false; if(isOrg && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,6}$/u.test(v) && !/(社|書店|テレビ|TV|MX|BS|AT-X|Aniplex|KADOKAWA|Studio|スタジオ|委員会|公司|出版社|ゲーム|ソフト|SILVER|LINK|MX|MBS|Yostar)/i.test(v)) return false; return true}
function walk(d,out=[]){if(!fs.existsSync(d))return out; for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name); if(x.isDirectory())walk(f,out); else if(/\.(json|jsonl|ndjson)$/i.test(x.name))out.push(f)} return out}
async function* readRows(file){if(/\.(jsonl|ndjson)$/i.test(file)){const rl=readline.createInterface({input:fs.createReadStream(file,'utf8'),crlfDelay:Infinity}); for await(const line of rl){if(!line.trim())continue; try{yield JSON.parse(line)}catch{}} return} const raw=fs.readFileSync(file,'utf8').trim(); if(!raw)return; let j; try{j=JSON.parse(raw)}catch{return}; if(Array.isArray(j)){for(const x of j)yield x; return} for(const k of ['data','items','subjects','docs','results','records']) if(Array.isArray(j?.[k])){for(const x of j[k])yield x; return} yield j}
function unwrap(v,out=[]){if(!v||typeof v!=='object')return out; if(Array.isArray(v)){for(const x of v)unwrap(x,out); return out} if(('id'in v||'subject_id'in v||'subjectId'in v)&&('name'in v||'name_cn'in v||'infobox'in v))out.push(v); for(const k of ['raw','subject','candidate','data','item']) if(v[k])unwrap(v[k],out); return out}
function vals(v,out=[]){if(v==null)return out; if(typeof v==='string'||typeof v==='number'){const s=clean(v); if(s)out.push(s); return out} if(Array.isArray(v)){for(const x of v)vals(x,out); return out} if(typeof v==='object') for(const k of ['v','value','name','title','text','label']) if(k in v) vals(v[k],out); return out}
function readJsonl(f){if(!fs.existsSync(f))return[]; const raw=fs.readFileSync(f,'utf8').trim(); return raw?raw.split(/\r?\n/).map(x=>JSON.parse(x)):[]}
function count(rows,key){const o={}; for(const r of rows){const k=typeof key==='function'?key(r):r[key]||'missing'; o[k]=(o[k]||0)+1} return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))))}
function add(map,row){const k=[row.workId,row.name,row.role,row.originalRole].map(x=>clean(x).toLowerCase()).join('|'); if(!map.has(k))map.set(k,row)}
function parseArgs(argv){const o={}; for(let i=0;i<argv.length;i++){const v=argv[i]; if(!v.startsWith('--'))continue; const k=v.slice(2), n=argv[i+1]; if(!n||n.startsWith('--')) o[k]=true; else{o[k]=n; i++}} return o}

const args=parseArgs(process.argv.slice(2)); const roots=String(args.roots||'').split(';').map(clean).filter(Boolean); const scanRoots=(roots.length?roots:ROOTS).filter(r=>fs.existsSync(r)); const outDir=String(args['out-dir']||OUT)
const byBgm=new Map(); for(const row of readJsonl(String(args.audit||AUDIT))){const id=clean(row.bangumiId); const works=(row.matchedWorks||[]).filter(w=>clean(w.match)==='external_id'); if(id&&works.length)byBgm.set(id,works)}
const files=scanRoots.flatMap(r=>walk(r)).filter(f=>/bangumi|bgm|subject/i.test(f)).sort((a,b)=>a.localeCompare(b))
const creator=new Map(), org=new Map(), skipped=[]; let rawRows=0, subjectsRead=0, subjectsMatched=0
for(const file of files) for await(const wrapper of readRows(file)){rawRows++; for(const rec of unwrap(wrapper)){subjectsRead++; const id=clean(rec.id||rec.subject_id||rec.subjectId||rec.bangumiSubjectId); const works=byBgm.get(id)||[]; if(!works.length)continue; subjectsMatched++; for(const info of Array.isArray(rec.infobox)?rec.infobox:[]){const key=clean(info?.key||info?.k||info?.label); if(!key||BAD_KEY.test(key)||mojibake(key)){skipped.push({bangumiId:id,key,reason:'bad_or_non_credit_key'}); continue} let cRole=CREATOR.get(key)||'', oRole=ORG.get(key)||''; if(!cRole&&CREATOR_OTHER.test(key)) cRole='other'; if(!oRole&&ORG_OTHER.test(key)) oRole='other'; if(!cRole&&!oRole){skipped.push({bangumiId:id,key,reason:'unmapped_key'}); continue} for(const rawName of vals(info?.value??info?.v)){ if(cRole) for(const name of splitPeople(rawName)){ if(valid(name,false)) for(const w of works)add(creator,{workId:clean(w.id),workTitle:clean(w.title),bangumiId:id,name,role:cRole,originalRole:key,source:'bangumi'}); else skipped.push({bangumiId:id,key,value:name,reason:'invalid_creator_name'}) } if(oRole) for(const name of splitOrgs(key,rawName)){ if(valid(name,true)) for(const w of works)add(org,{workId:clean(w.id),workTitle:clean(w.title),bangumiId:id,name,role:oRole,originalRole:key,source:'bangumi'}); else skipped.push({bangumiId:id,key,value:name,reason:'invalid_organization_name'}) } } } } }
const creators=[...creator.values()], orgs=[...org.values()]
const outputs={creators:path.join(outDir,'bangumi-credits-v03-creators.jsonl'),organizations:path.join(outDir,'bangumi-credits-v03-organizations.jsonl'),skipped:path.join(outDir,'bangumi-credits-v03-skipped.jsonl'),summary:path.join(outDir,'bangumi-credits-v03-summary.json'),samples:path.join(outDir,'bangumi-credits-v03-samples.json')}
const summary={generatedAt:new Date().toISOString(),version:VERSION,ok:true,scanRoots,filesScanned:files.length,rawRows,subjectsRead,matchedBangumiIds:byBgm.size,subjectsMatched,creatorCreditRows:creators.length,organizationCreditRows:orgs.length,creatorNames:new Set(creators.map(x=>x.name.toLowerCase())).size,organizationNames:new Set(orgs.map(x=>x.name.toLowerCase())).size,worksWithCreatorCredits:new Set(creators.map(x=>x.workId)).size,worksWithOrganizationCredits:new Set(orgs.map(x=>x.workId)).size,skippedRows:skipped.length,byCreatorRole:count(creators,'role'),byOrganizationRole:count(orgs,'role'),bySkippedReason:count(skipped,'reason'),bySkippedKey:count(skipped,'key'),outputs,safety:{readOnly:true,payloadRead:false,payloadWrite:false,directPostgresqlWrite:false,dataChanged:false}}
fs.mkdirSync(outDir,{recursive:true}); fs.writeFileSync(outputs.creators,creators.map(x=>JSON.stringify(x)).join('\n')+(creators.length?'\n':''),'utf8'); fs.writeFileSync(outputs.organizations,orgs.map(x=>JSON.stringify(x)).join('\n')+(orgs.length?'\n':''),'utf8'); fs.writeFileSync(outputs.skipped,skipped.map(x=>JSON.stringify(x)).join('\n')+(skipped.length?'\n':''),'utf8'); fs.writeFileSync(outputs.summary,JSON.stringify(summary,null,2),'utf8'); fs.writeFileSync(outputs.samples,JSON.stringify({creators:creators.slice(0,100),organizations:orgs.slice(0,100),skipped:skipped.slice(0,80)},null,2),'utf8'); console.log(JSON.stringify({ok:true,summary,outputs},null,2))
