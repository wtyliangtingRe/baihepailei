#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const v01Path='data_local/staging/public-catalog-import/public-catalog-import-preview-v01.json'
const sourcePath='data_local/staging/completed-source-candidates/source-candidates.jsonl'
const outDir='data_local/staging/public-catalog-import'
const outJson=path.join(outDir,'public-catalog-import-preview-v02.json')
const outJsonl=path.join(outDir,'public-catalog-import-preview-v02.jsonl')
const outSummary=path.join(outDir,'public-catalog-import-preview-v02-summary.json')
const outMd=path.join(outDir,'public-catalog-import-preview-v02.md')
const outPayload=path.join(outDir,'public-catalog-import-preview-v02.payload.json')

const importBatch='public-catalog-import-v02'
const allowedPayloadCandidateSources=new Set(['yurizukan','bangumi','mangadex','ndl','steam','wikidata','anilist','vndb','wikipedia','manual','other'])
const allowedReviewReasons=new Set(['radar_seed_attached','source_conflict','multi_source_or_variant','wikidata_candidate_review','wikidata_quarantine','manual_review','other'])

function readJsonl(file){return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map((line,i)=>{try{return JSON.parse(line)}catch(e){throw new Error(`JSONL parse failed ${file}:${i+1}: ${e.message}`)}})}
function norm(v){return String(v||'').trim().toLowerCase()}
function source(v){const r=norm(v); if(!r)return'unknown'; if(r.includes('yurizukan'))return'yurizukan'; if(r.includes('bangumi')||r==='bgm')return'bangumi'; if(r.includes('mangadex'))return'mangadex'; if(r.includes('steam'))return'steam'; if(r.includes('wikidata'))return'wikidata'; if(r.includes('anilist'))return'anilist'; if(r==='ndl'||r.includes('national diet library'))return'ndl'; return r.replace(/[^a-z0-9]+/g,'-')||'unknown'}
function payloadSource(v){const s=source(v); return allowedPayloadCandidateSources.has(s)?s:'other'}
function ratingNotice(v){const r=String(v||'').trim(); const n=norm(r); if(!r)return'ai_synthesized_pending_review'; if(n.includes('ai')||r.includes('AI 综合'))return'ai_synthesized_pending_review'; if(r.includes('信息不足')||n.includes('insufficient'))return'insufficient_information'; if(r.includes('人工')||n.includes('manual'))return'manual_reviewed'; if(r==='无'||n==='none')return'none'; return'other'}
function reviewReasons(row,noteValues){const reasons=new Set(); const notes=(noteValues||[]).map(v=>String(v||'')); if(notes.some(v=>v.startsWith('multi_source:'))){reasons.add('source_conflict'); reasons.add('multi_source_or_variant')} if(notes.includes('radar_seed_attached')||(row.radarSeedRefs||[]).length)reasons.add('radar_seed_attached'); if(notes.includes('wikidata_candidate_review_refs_present')||(row.wikidataCandidateReviewRefs||[]).length)reasons.add('wikidata_candidate_review'); if(notes.includes('wikidata_quarantine_refs_present')||(row.wikidataQuarantineRefs||[]).length)reasons.add('wikidata_quarantine'); if(notes.includes('unresolved_source_candidate_refs'))reasons.add('other'); return [...reasons].filter(v=>allowedReviewReasons.has(v))}
function countBy(rows,fn){const o={}; for(const r of rows){const k=String(fn(r)||'unknown'); o[k]=(o[k]||0)+1} return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]))}
function rank(s){const a=['yurizukan','bangumi','mangadex','ndl','steam','wikidata','anilist']; const i=a.indexOf(source(s)); return i<0?999:i+1}
function byId(rows){const m=new Map(); const add=(k,r)=>{k=norm(k); if(k&&!m.has(k))m.set(k,r)}; for(const r of rows){add(r.stagingId,r); add(r.sourceId,r); add(r.externalId,r)} return m}
function find(m,v,row){const keys=[v.sourceCandidateId,v.externalId,...(Array.isArray(row.sourceCandidateIds)?row.sourceCandidateIds:[]),...(Array.isArray(row.sourceRefs)?row.sourceRefs:[])]; for(const k of keys){const r=m.get(norm(k)); if(r)return r} return null}
function enrich(m,v,row){const c=find(m,v,row); return {...v,source:source(c?.stagingSource||c?.externalSite||v.source),title:c?.title||v.title||row.title,mediaType:c?.mediaType||v.mediaType,externalId:c?.externalId||v.externalId||'',externalUrl:c?.externalUrl||'',sourceId:c?.sourceId||'',sourceFile:c?.sourceFile||'',confidenceBucket:c?.confidenceBucket||'',alignmentStatus:c?.alignmentStatus||'',resolvedSourceCandidate:Boolean(c)}}
function sortVars(vs){return [...vs].sort((a,b)=>rank(a.source)-rank(b.source)||String(a.title||'').localeCompare(String(b.title||'')))}
function candidateSources(vs){return vs.map(v=>({source:v.source,label:v.title||'',externalId:v.externalId||'',url:v.externalUrl||'',note:[v.sourceCandidateId?`stagingId=${v.sourceCandidateId}`:'',v.sourceId?`sourceId=${v.sourceId}`:'',v.mediaType?`mediaType=${v.mediaType}`:'',v.confidenceBucket?`confidence=${v.confidenceBucket}`:'',v.alignmentStatus?`alignment=${v.alignmentStatus}`:'',v.sourceFile?`sourceFile=${v.sourceFile}`:''].filter(Boolean).join('; ')}))}
function notes(row){const ns=[]; if(row.suggestedVariants.some(v=>!v.resolvedSourceCandidate))ns.push('unresolved_source_candidate_refs'); const ss=[...new Set(row.suggestedVariants.map(v=>v.source).filter(s=>s!=='unknown'))]; if(ss.length>1)ns.push(`multi_source: ${ss.join(', ')}`); if((row.radarSeedRefs||[]).length)ns.push('radar_seed_attached'); if((row.wikidataCandidateReviewRefs||[]).length)ns.push('wikidata_candidate_review_refs_present'); if((row.wikidataQuarantineRefs||[]).length)ns.push('wikidata_quarantine_refs_present'); return ns}

const v01=JSON.parse(fs.readFileSync(v01Path,'utf8'))
const candidates=readJsonl(sourcePath)
const index=byId(candidates)
const v02=v01.map(row=>{const vs=sortVars((row.suggestedVariants||[]).map(v=>enrich(index,v,row))); const base=vs[0]||null; const cs=candidateSources(vs); const sourceConflictNotes=notes({...row,suggestedVariants:vs}); return {...row,previewId:row.previewId.replace('pcipv01-','pcipv02-'),chosenBaseSource:base?.source||'unknown',chosenBaseSourceRank:rank(base?.source),suggestedVariants:vs,candidateSources:cs,sourceConflictNotes,payloadDraft:{...row.payloadDraft,importBatch,ratingNotice:ratingNotice(row.ratingNotice),chosenBaseSource:payloadSource(base?.source),reviewReasons:reviewReasons({...row,suggestedVariants:vs},sourceConflictNotes),sourceConflictNotes:sourceConflictNotes.join('\n'),candidateSources:cs,evidenceNote:[`Preview generated from ${row.mergeGroupId}.`,`Base source: ${base?.source||'unknown'}.`,row.ratingNotice?`Rating notice: ${row.ratingNotice}.`:'',row.ratingClasses?.length?`Rating classes: ${row.ratingClasses.join(', ')}.`:'',sourceConflictNotes.length?`Review notes: ${sourceConflictNotes.join(' | ')}`:'','AI 综合，待复核。'].filter(Boolean).join('\n')}}})
const reviewQueue=v02.filter(r=>r.sourceConflictNotes.length||(r.radarSeedRefs||[]).length||(r.wikidataCandidateReviewRefs||[]).length||(r.wikidataQuarantineRefs||[]).length)
const summary={generatedAt:new Date().toISOString(),previews:v02.length,payloadDraftWorks:v02.length,reviewQueueRows:reviewQueue.length,resolvedSourceCandidateRows:v02.filter(r=>r.suggestedVariants.some(v=>v.resolvedSourceCandidate)).length,unresolvedSourceCandidateRows:v02.filter(r=>r.suggestedVariants.some(v=>!v.resolvedSourceCandidate)).length,bySource:countBy(v02,r=>r.chosenBaseSource),byCandidateSource:countBy(candidates,r=>source(r.stagingSource||r.externalSite)),byRank:countBy(v02,r=>r.rank),byNotice:countBy(v02,r=>r.ratingNotice),byReviewReason:countBy(reviewQueue.flatMap(r=>r.sourceConflictNotes.map(note=>({note}))),r=>r.note.split(':')[0]),safety:{payloadWrite:false,postgresqlWrite:false,importerApply:false,delete:false}}
const payloadSeed={generatedAt:summary.generatedAt,seedId:'public-catalog-import-preview-v02',safety:summary.safety,works:v02.map(r=>r.payloadDraft)}
fs.mkdirSync(outDir,{recursive:true})
fs.writeFileSync(outJson,JSON.stringify(v02,null,2),'utf8')
fs.writeFileSync(outJsonl,v02.map(r=>JSON.stringify(r)).join('\n')+'\n','utf8')
fs.writeFileSync(outSummary,JSON.stringify(summary,null,2),'utf8')
fs.writeFileSync(outPayload,JSON.stringify(payloadSeed,null,2),'utf8')
fs.writeFileSync(outMd,['# Public Catalog Import Preview v0.2','','## Safety','','- No Payload write.','- No PostgreSQL write.','- No importer apply.','- No delete.','','## Summary','',`- previews: ${summary.previews}`,`- reviewQueueRows: ${summary.reviewQueueRows}`,`- resolvedSourceCandidateRows: ${summary.resolvedSourceCandidateRows}`,`- unresolvedSourceCandidateRows: ${summary.unresolvedSourceCandidateRows}`,'','## By source','','```json',JSON.stringify(summary.bySource,null,2),'```','','## By candidate source','','```json',JSON.stringify(summary.byCandidateSource,null,2),'```','','## By rank','','```json',JSON.stringify(summary.byRank,null,2),'```','','## By notice','','```json',JSON.stringify(summary.byNotice,null,2),'```','','## By review reason','','```json',JSON.stringify(summary.byReviewReason,null,2),'```','','## Sample rows','','```json',JSON.stringify(v02.slice(0,3),null,2),'```',''].join('\n'),'utf8')
console.log(JSON.stringify({ok:true,previews:summary.previews,reviewQueueRows:summary.reviewQueueRows,resolvedSourceCandidateRows:summary.resolvedSourceCandidateRows,unresolvedSourceCandidateRows:summary.unresolvedSourceCandidateRows,bySource:summary.bySource,outputs:{json:outJson,jsonl:outJsonl,summary:outSummary,md:outMd,payloadSeed:outPayload}},null,2))

