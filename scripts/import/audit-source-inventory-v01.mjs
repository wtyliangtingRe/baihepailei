#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'source-inventory-audit-v0.2'
const DEFAULT_ROOTS = ['data_local/raw', 'E:/data/baihepailei/data_local/raw']
const OUT = 'data_local/staging/source-inventory'

function clean(v){return String(v??'').replaceAll('\r',' ').replaceAll('\n',' ').replace(/\s+/g,' ').trim()}
function parseArgs(argv){const o={}; for(let i=0;i<argv.length;i++){const v=argv[i]; if(!v.startsWith('--'))continue; const k=v.slice(2), n=argv[i+1]; if(!n||n.startsWith('--'))o[k]=true; else{o[k]=n;i++}} return o}
function walk(dir,out=[]){if(!fs.existsSync(dir))return out; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.isDirectory())walk(p,out); else out.push(p)} return out}
function sourceOf(file, roots){const rel=roots.map(r=>path.relative(r,file)).find(x=>x&&!x.startsWith('..')&&!path.isAbsolute(x))||path.basename(file); return rel.split(/[\\/]/)[0]||'root'}
function preview(v){if(Array.isArray(v))return {type:'array',length:v.length,first:preview(v[0])}; if(v&&typeof v==='object')return {type:'object',keys:Object.keys(v).slice(0,40)}; return {type:typeof v,value:clean(v).slice(0,120)}}
async function countJsonl(file){let rows=0, parseErrors=0; const samples=[]; const rl=readline.createInterface({input:fs.createReadStream(file,'utf8'),crlfDelay:Infinity}); for await(const line of rl){const body=line.trim(); if(!body)continue; rows++; if(samples.length<3){try{samples.push(preview(JSON.parse(body)))}catch{parseErrors++}} else {try{JSON.parse(body)}catch{parseErrors++}}} return {rows,parseErrors,samples}}
function inspectJson(value){if(Array.isArray(value))return {rows:value.length,samples:value.slice(0,3).map(preview),shape:'array'}; if(value&&typeof value==='object'){for(const k of ['data','items','subjects','docs','results','records']) if(Array.isArray(value[k])) return {rows:value[k].length,samples:value[k].slice(0,3).map(preview),shape:`object.${k}`}; return {rows:1,samples:[preview(value)],shape:'object'}} return {rows:0,samples:[],shape:typeof value}}
async function inspect(file){const ext=path.extname(file).toLowerCase(); const stat=fs.statSync(file); const base={file,ext,sizeBytes:stat.size,rows:0,parseErrors:0,shape:'unknown',samples:[]}; try{if(ext==='.jsonl'||ext==='.ndjson')return {...base,...await countJsonl(file)}; if(ext==='.json'){const raw=fs.readFileSync(file,'utf8').trim(); if(!raw)return {...base,shape:'empty'}; return {...base,...inspectJson(JSON.parse(raw))};} return base}catch(e){return {...base,parseErrors:1,error:String(e?.message||e).slice(0,300)}}}
function count(rows,key){const o={}; for(const r of rows){const k=typeof key==='function'?key(r):r[key]||'missing'; o[k]=(o[k]||0)+1} return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))))}
function add(map,k,patch){if(!map.has(k))map.set(k,{source:k,files:0,totalBytes:0,totalRows:0,parseErrors:0,extensions:{},sampleFiles:[]}); const x=map.get(k); x.files++; x.totalBytes+=patch.sizeBytes||0; x.totalRows+=patch.rows||0; x.parseErrors+=patch.parseErrors||0; x.extensions[patch.ext||'none']=(x.extensions[patch.ext||'none']||0)+1; if(x.sampleFiles.length<10)x.sampleFiles.push({file:patch.file,sizeBytes:patch.sizeBytes,rows:patch.rows,shape:patch.shape,parseErrors:patch.parseErrors,samples:patch.samples})}
function writeJsonl(file, rows){const ws=fs.createWriteStream(file,{encoding:'utf8'}); for(const r of rows)ws.write(JSON.stringify(r)+'\n'); ws.end()}
const args=parseArgs(process.argv.slice(2)); const roots=String(args.roots||'').split(';').map(clean).filter(Boolean); const scanRoots=(roots.length?roots:DEFAULT_ROOTS).filter(r=>fs.existsSync(r)); const outDir=String(args['out-dir']||OUT)
const allFiles=scanRoots.flatMap(r=>walk(r)).filter(f=>/\.(json|jsonl|ndjson|csv|tsv|txt|h5|gz|zip)$/i.test(f)).sort((a,b)=>a.localeCompare(b))
const files=[]; const bySource=new Map(); for(const f of allFiles){const info=await inspect(f); info.source=sourceOf(f,scanRoots); files.push(info); add(bySource,info.source,info)}
const sources=[...bySource.values()].sort((a,b)=>b.totalRows-a.totalRows||b.files-a.files||a.source.localeCompare(b.source))
const outputs={files:path.join(outDir,'source-inventory-v01-files.jsonl'),sources:path.join(outDir,'source-inventory-v01-sources.json'),summary:path.join(outDir,'source-inventory-v01-summary.json')}
const summary={generatedAt:new Date().toISOString(),version:VERSION,ok:true,scanRoots,filesScanned:files.length,totalBytes:files.reduce((s,x)=>s+x.sizeBytes,0),totalRows:files.reduce((s,x)=>s+x.rows,0),parseErrors:files.reduce((s,x)=>s+x.parseErrors,0),sources:sources.length,byExtension:count(files,'ext'),topSources:sources.slice(0,30),outputs,safety:{readOnly:true,payloadRead:false,payloadWrite:false,directPostgresqlWrite:false,dataChanged:false}}
fs.mkdirSync(outDir,{recursive:true}); writeJsonl(outputs.files,files); fs.writeFileSync(outputs.sources,JSON.stringify(sources,null,2),'utf8'); fs.writeFileSync(outputs.summary,JSON.stringify(summary,null,2),'utf8'); console.log(JSON.stringify({ok:true,summary,outputs},null,2))
