#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'bangumi-credit-relations-apply-v0.1'
const IN_DIR = 'data_local/staging/work-source-metadata'
const CREATOR_CREDITS = `${IN_DIR}/bangumi-credits-v03-creators.jsonl`
const ORG_CREDITS = `${IN_DIR}/bangumi-credits-v03-organizations.jsonl`
const ENTITY_ROWS = `${IN_DIR}/bangumi-credit-entities-create-v01.rows.jsonl`
const OUT = IN_DIR
const CONFIRM = 'apply-bangumi-credit-relations-v01'

function clean(v){return String(v??'').replaceAll('\r',' ').replaceAll('\n',' ').replace(/\s+/g,' ').trim()}
function readJsonl(file){if(!fs.existsSync(file))throw new Error(`Input not found: ${file}`); const raw=fs.readFileSync(file,'utf8').trim(); return raw?raw.split(/\r?\n/).map(x=>JSON.parse(x)):[]}
function count(rows,key){const o={}; for(const r of rows){const k=typeof key==='function'?key(r):r[key]||'missing'; o[k]=(o[k]||0)+1} return o}
function parseArgs(argv){const out={}; for(let i=0;i<argv.length;i++){const v=argv[i]; if(!v.startsWith('--'))continue; const k=v.slice(2), n=argv[i+1]; if(!n||n.startsWith('--'))out[k]=true; else{out[k]=n;i++}} return out}
async function json(url,opt={}){const res=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}}); const text=await res.text(); const data=text?JSON.parse(text):null; if(!res.ok)throw new Error(`${res.status} ${text.slice(0,400)}`); return data}
async function getDoc(base, token, collection, id){return json(`${base}/api/${collection}/${id}?depth=0&draft=true`,{headers:{Authorization:`JWT ${token}`}})}
function idOf(v){if(v==null)return''; if(typeof v==='string'||typeof v==='number')return String(v); return String(v.id||v.value||'')}
function loadEntityMap(rows){const m=new Map(); for(const r of rows){const name=clean(r.name).toLowerCase(); const id=clean(r.entityId); if(name&&id&&(String(r.status).startsWith('already_exists')||r.status==='created'))m.set(`${r.kind}:${name}`,id)} return m}
function relKey(x){return [idOf(x.creator||x.organization), clean(x.role), clean(x.originalRole), clean(x.source||'bangumi')].join('|').toLowerCase()}
function mergeCreators(current, additions){const existing=Array.isArray(current)?current.map(idOf).filter(Boolean):[]; const seen=new Set(existing); for(const id of additions)if(id&&!seen.has(String(id))){existing.push(String(id));seen.add(String(id))} return existing}
function mergeCreditArray(current, additions, field){const out=Array.isArray(current)?current.map(x=>({...x})):[]; const seen=new Set(out.map(relKey)); for(const a of additions){const k=relKey(a); if(!seen.has(k)){out.push(a);seen.add(k)}} return out}
function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b)}

const args=parseArgs(process.argv.slice(2))
const base=String(args.url||process.env.NEXT_PUBLIC_SERVER_URL||'http://localhost:3000').replace(/\/$/,'')
const apply=Boolean(args.apply)
if(apply&&String(args.confirm||'')!==CONFIRM)throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email=process.env.PAYLOAD_EXPORT_EMAIL||process.env.PAYLOAD_SEED_EMAIL
const password=process.env.PAYLOAD_EXPORT_PASSWORD||process.env.PAYLOAD_SEED_PASSWORD
if(!email||!password)throw new Error('Missing Payload login env vars')
const includeOther=Boolean(args['include-other'])
const creatorRows=readJsonl(String(args.creators||CREATOR_CREDITS)).filter(r=>includeOther||clean(r.role)!=='other')
const orgRows=readJsonl(String(args.organizations||ORG_CREDITS)).filter(r=>includeOther||clean(r.role)!=='other')
const entityMap=loadEntityMap(readJsonl(String(args.entities||ENTITY_ROWS)))
const byWork=new Map()
function bucket(workId){const id=clean(workId); if(!byWork.has(id))byWork.set(id,{workId:id,creatorIds:new Set(),creatorCredits:[],organizationCredits:[],missing:[]}); return byWork.get(id)}
for(const r of creatorRows){const eid=entityMap.get(`creator:${clean(r.name).toLowerCase()}`); const b=bucket(r.workId); if(!eid){b.missing.push(`creator:${r.name}`); continue} b.creatorIds.add(eid); b.creatorCredits.push({creator:eid,role:clean(r.role),originalRole:clean(r.originalRole),source:'bangumi',note:`Bangumi subject ${clean(r.bangumiId)}`})}
for(const r of orgRows){const eid=entityMap.get(`organization:${clean(r.name).toLowerCase()}`); const b=bucket(r.workId); if(!eid){b.missing.push(`organization:${r.name}`); continue} b.organizationCredits.push({organization:eid,role:clean(r.role),originalRole:clean(r.originalRole),source:'bangumi',note:`Bangumi subject ${clean(r.bangumiId)}`})}
const login=await json(`${base}/api/users/login`,{method:'POST',body:JSON.stringify({email,password})})
const token=login.token, auth={Authorization:`JWT ${token}`}
const rows=[]; let wouldPatch=0, patched=0, alreadyCurrent=0, blocked=0
for(const plan of byWork.values()){
  const row={workId:plan.workId,status:'',creatorCredits:plan.creatorCredits.length,organizationCredits:plan.organizationCredits.length,creatorIds:plan.creatorIds.size,changedFields:[],blockers:[]}
  try{
    if(!plan.workId)row.blockers.push('missing_workId')
    if(plan.missing.length)row.blockers.push('missing_entity:'+plan.missing.slice(0,5).join(','))
    if(!row.blockers.length){
      const current=await getDoc(base,token,'works',plan.workId)
      const nextCreators=mergeCreators(current.creators,[...plan.creatorIds])
      const nextCreatorCredits=mergeCreditArray(current.creatorCredits,plan.creatorCredits,'creator')
      const nextOrganizations=mergeCreditArray(current.organizations,plan.organizationCredits,'organization')
      const body={}
      if(!sameJson(nextCreators,Array.isArray(current.creators)?current.creators.map(idOf).filter(Boolean):[])){body.creators=nextCreators;row.changedFields.push('creators')}
      if(!sameJson(nextCreatorCredits,current.creatorCredits||[])){body.creatorCredits=nextCreatorCredits;row.changedFields.push('creatorCredits')}
      if(!sameJson(nextOrganizations,current.organizations||[])){body.organizations=nextOrganizations;row.changedFields.push('organizations')}
      if(!row.changedFields.length){row.status='already_current';alreadyCurrent++}
      else if(apply){await json(`${base}/api/works/${plan.workId}?draft=true`,{method:'PATCH',headers:auth,body:JSON.stringify(body)});row.status='patched';patched++}
      else{row.status='would_patch';wouldPatch++}
    }
    if(row.blockers.length){row.status='blocked';blocked++}
  }catch(e){row.status='blocked';row.blockers.push(String(e?.message||e).slice(0,400));blocked++}
  rows.push(row)
}
const outputs={rows:`${OUT}/bangumi-credit-relations-v01.rows.jsonl`,summary:`${OUT}/bangumi-credit-relations-v01-summary.json`}
const summary={generatedAt:new Date().toISOString(),version:VERSION,mode:apply?'apply':'dry-run',includeOther,creatorCreditRows:creatorRows.length,organizationCreditRows:orgRows.length,workPlans:byWork.size,wouldPatch,patched,alreadyCurrent,blocked,byStatus:count(rows,'status'),byChangedField:count(rows.flatMap(r=>r.changedFields),(x)=>x),byBlocker:count(rows.flatMap(r=>r.blockers),(x)=>String(x).split(':')[0]),outputs,safety:{payloadWrite:apply,collection:'works',fields:['creators','creatorCredits','organizations'],directPostgresqlWrite:false}}
fs.mkdirSync(OUT,{recursive:true}); fs.writeFileSync(outputs.rows,rows.map(x=>JSON.stringify(x)).join('\n')+(rows.length?'\n':''),'utf8'); fs.writeFileSync(outputs.summary,JSON.stringify(summary,null,2),'utf8'); console.log(JSON.stringify({ok:blocked===0,summary,outputs},null,2))
