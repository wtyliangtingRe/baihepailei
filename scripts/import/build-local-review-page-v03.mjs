#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const QUEUE = 'data_local/staging/review/combined-review-queue-v01.jsonl'
const SUMMARY = 'data_local/staging/review/combined-review-queue-v01-summary.json'
const OUT = 'data_local/staging/review/local-review-page-v03.html'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function compactRow(row) {
  return {
    combinedQueueId: row.combinedQueueId ?? '',
    queueSource: row.queueSource ?? '',
    priority: row.priority ?? '',
    issueType: row.issueType ?? '',
    title: row.title ?? row.normalizedTitle ?? '',
    normalizedTitle: row.normalizedTitle ?? '',
    sourceName: row.sourceName ?? '',
    sourceId: row.sourceId ?? '',
    sourceRecordKey: row.sourceRecordKey ?? '',
    candidateId: row.candidateId ?? '',
    groupId: row.groupId ?? '',
    candidateClass: row.candidateClass ?? '',
    candidateType: row.candidateType ?? '',
    score: row.score ?? '',
    reviewReason: row.reviewReason ?? '',
    suggestedAction: row.suggestedAction ?? '',
    reviewOnly: row.reviewOnly === true,
    applyAllowed: row.applyAllowed === true,
  }
}

function html(report, rows) {
  const dataJson = JSON.stringify(rows).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026')
  const summaryJson = JSON.stringify(report, null, 2)

  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>百合排雷本地 Review Queue v0.4</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light dark; --bg:#f7f7fb; --panel:#fff; --text:#111827; --muted:#6b7280; --line:#e5e7eb; --p1:#fee2e2; --p2:#fef3c7; --p3:#dbeafe; --chip:#eef2ff; --active:#c7d2fe; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; --sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f172a; --panel:#111827; --text:#e5e7eb; --muted:#9ca3af; --line:#374151; --p1:#4c1d1d; --p2:#463512; --p3:#172554; --chip:#1e1b4b; --active:#3730a3; } }
* { box-sizing:border-box; }
body { margin:0; font-family:var(--sans); background:var(--bg); color:var(--text); }
header { position:sticky; top:0; z-index:10; padding:18px 24px; background:var(--panel); border-bottom:1px solid var(--line); }
h1 { margin:0 0 8px; font-size:24px; }
main { padding:18px 24px 40px; max-width:1900px; margin:0 auto; }
.card, .toolbar, .table-wrap, details, .status { background:var(--panel); border:1px solid var(--line); border-radius:14px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:14px; }
.card { padding:14px; }
.label { color:var(--muted); font-size:12px; }
.value { font-size:22px; font-weight:750; margin-top:6px; }
.toolbar { display:grid; grid-template-columns:minmax(260px,1.2fr) repeat(5,minmax(140px,.8fr)); gap:12px; padding:14px; margin-bottom:14px; align-items:end; }
@media (max-width:1200px) { .toolbar { grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); } }
label { display:grid; gap:6px; color:var(--muted); font-size:12px; }
input, select, button, textarea { border:1px solid var(--line); border-radius:10px; padding:9px 10px; background:var(--bg); color:var(--text); font:inherit; }
button { cursor:pointer; font-weight:650; background:var(--chip); }
button.active { background:var(--active); }
.quick { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.note, .status { color:var(--muted); font-size:12px; margin:8px 0 12px; }
.status { padding:10px 12px; }
.table-wrap { overflow:auto; max-height:calc(100vh - 300px); min-height:380px; }
table { width:100%; min-width:1500px; border-collapse:separate; border-spacing:0; }
thead th { position:sticky; top:0; z-index:4; background:var(--panel); box-shadow:0 1px 0 var(--line); }
th,td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; text-align:left; font-size:13px; }
th { color:var(--muted); font-size:12px; white-space:nowrap; }
tbody tr[data-priority="P1"] { background:var(--p1); }
tbody tr[data-priority="P2"] { background:var(--p2); }
tbody tr[data-priority="P3"] { background:var(--p3); }
.mono { font-family:var(--mono); font-size:12px; word-break:break-all; }
.muted { color:var(--muted); }
.chip { display:inline-flex; border-radius:999px; padding:3px 8px; background:var(--chip); font-size:12px; white-space:nowrap; }
.title { font-weight:750; margin-bottom:4px; }
textarea { width:240px; min-height:54px; resize:vertical; }
.row-actions { display:grid; gap:6px; }
.copy { width:auto; padding:4px 7px; font-size:11px; margin-top:5px; }
.saved { outline:2px solid var(--active); outline-offset:-2px; }
details { padding:12px 14px; margin-top:16px; }
pre { overflow:auto; font-family:var(--mono); font-size:12px; line-height:1.5; }
</style>
</head>
<body>
<header>
  <h1>百合排雷本地 Review Queue v0.4</h1>
  <div class="muted">生成时间：${esc(report.generatedAt)} · 本页面只读 · 草稿保存在浏览器 localStorage · 可导入/导出 JSON</div>
</header>
<main>
  <section class="cards">
    <div class="card"><div class="label">combinedRows</div><div class="value" id="totalRows">0</div></div>
    <div class="card"><div class="label">当前筛选结果</div><div class="value" id="visibleRows">0</div></div>
    <div class="card"><div class="label">已记录草稿</div><div class="value" id="draftRows">0</div></div>
    <div class="card"><div class="label">P1</div><div class="value" id="p1Rows">0</div></div>
    <div class="card"><div class="label">P2</div><div class="value" id="p2Rows">0</div></div>
    <div class="card"><div class="label">P3</div><div class="value" id="p3Rows">0</div></div>
  </section>
  <section class="quick">
    <button data-priority="P1">只看 P1</button><button data-priority="P2">只看 P2</button><button data-priority="P3">只看 P3</button>
    <button data-source="identity">只看 identity</button><button data-source="work_graph">只看 work_graph</button>
    <button id="onlyDrafts">只看已记录草稿</button><button id="exportDrafts">导出草稿 JSON</button><button id="importDrafts">导入草稿 JSON</button><button id="clearDrafts">清空本地草稿</button>
    <input id="importFile" type="file" accept="application/json,.json" hidden>
  </section>
  <section class="toolbar">
    <label>关键词<input id="q" type="search" placeholder="标题 / sourceId / issueType / reason"></label>
    <label>Priority<select id="priority"><option value="">全部</option><option>P1</option><option>P2</option><option>P3</option></select></label>
    <label>Source<select id="queueSource"><option value="">全部</option></select></label>
    <label>Issue Type<select id="issueType"><option value="">全部</option></select></label>
    <label>每页数量<select id="pageSize"><option>50</option><option selected>100</option><option>250</option><option>500</option><option>1000</option></select></label>
    <label>显示选项<span><input id="hideTitleSamples" type="checkbox"> 隐藏 title_match 样本</span></label>
    <button id="reset">清空筛选</button>
  </section>
  <p class="note" id="resultNote"></p>
  <p class="status" id="importStatus">导入状态：尚未导入。</p>
  <section class="table-wrap"><table><thead><tr><th>Priority</th><th>Source</th><th>Issue</th><th>Title</th><th>Source ID</th><th>Candidate</th><th>Score</th><th>Review Draft</th><th>Suggested Action</th><th>Reason</th><th>Safety</th></tr></thead><tbody id="tbody"></tbody></table></section>
  <details><summary>Summary JSON</summary><pre>${esc(summaryJson)}</pre></details>
</main>
<script>
const rows = ${dataJson};
const storageKey = 'baihepailei.localReviewDrafts.v01';
const rowIds = new Set(rows.map((row) => row.combinedQueueId));
const state = { q:'', priority:'', queueSource:'', issueType:'', pageSize:100, hideTitleSamples:false, onlyDrafts:false };
let drafts = loadDrafts();
const el = {
  q: document.querySelector('#q'), priority: document.querySelector('#priority'), queueSource: document.querySelector('#queueSource'), issueType: document.querySelector('#issueType'), pageSize: document.querySelector('#pageSize'), hideTitleSamples: document.querySelector('#hideTitleSamples'), onlyDrafts: document.querySelector('#onlyDrafts'), exportDrafts: document.querySelector('#exportDrafts'), importDrafts: document.querySelector('#importDrafts'), importFile: document.querySelector('#importFile'), clearDrafts: document.querySelector('#clearDrafts'), reset: document.querySelector('#reset'), tbody: document.querySelector('#tbody'), resultNote: document.querySelector('#resultNote'), importStatus: document.querySelector('#importStatus'), totalRows: document.querySelector('#totalRows'), visibleRows: document.querySelector('#visibleRows'), draftRows: document.querySelector('#draftRows'), p1Rows: document.querySelector('#p1Rows'), p2Rows: document.querySelector('#p2Rows'), p3Rows: document.querySelector('#p3Rows'),
};
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function unique(field) { return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b))); }
function addOptions(select, values) { for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); } }
function loadDrafts() { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } }
function saveDrafts() { localStorage.setItem(storageKey, JSON.stringify(drafts)); }
function rowKey(row) { return row.combinedQueueId; }
function rowText(row) { return [row.priority,row.queueSource,row.issueType,row.title,row.normalizedTitle,row.sourceName,row.sourceId,row.sourceRecordKey,row.candidateClass,row.candidateType,row.reviewReason,row.suggestedAction].join(' ').toLowerCase(); }
function isTitleMatchSample(row) { return row.issueType === 'identity_title_match_sample' || row.issueType === 'identity_title_match_noise' || row.candidateType === 'title_match'; }
function filteredRows() { const q = state.q.trim().toLowerCase(); return rows.filter((row) => { if (state.priority && row.priority !== state.priority) return false; if (state.queueSource && row.queueSource !== state.queueSource) return false; if (state.issueType && row.issueType !== state.issueType) return false; if (state.hideTitleSamples && isTitleMatchSample(row)) return false; if (state.onlyDrafts && !drafts[rowKey(row)]) return false; if (q && !rowText(row).includes(q)) return false; return true; }); }
function draftSelectHtml(row) { const draft = drafts[rowKey(row)] || {}; const action = draft.reviewDecision || ''; const options = [['','未选择'],['keep_separate','保持分开'],['same_identity_candidate','疑似同一身份/作品'],['not_same_identity','不是同一身份/作品'],['defer','暂缓']]; return '<select data-draft-action="' + escapeHtml(rowKey(row)) + '">' + options.map(([value,label]) => '<option value="' + escapeHtml(value) + '"' + (action === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>').join('') + '</select>'; }
function draftNoteHtml(row) { const draft = drafts[rowKey(row)] || {}; return '<textarea data-draft-note="' + escapeHtml(rowKey(row)) + '" placeholder="本地备注，不写入数据库">' + escapeHtml(draft.note || '') + '</textarea>'; }
function draftPayload(row) { const draft = drafts[rowKey(row)] || {}; return { combinedQueueId: row.combinedQueueId, queueSource: row.queueSource, priority: row.priority, issueType: row.issueType, title: row.title, sourceName: row.sourceName, sourceId: row.sourceId, sourceRecordKey: row.sourceRecordKey, candidateId: row.candidateId, groupId: row.groupId, reviewDecision: draft.reviewDecision || '', note: draft.note || '', updatedAt: draft.updatedAt || '', safety: { localDraftOnly:true, payloadWrite:false, postgresqlWrite:false, importerAction:false, applyAllowed:false } }; }
function setDraft(key, patch) { const current = drafts[key] || {}; const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; if (!next.reviewDecision && !next.note) delete drafts[key]; else drafts[key] = next; saveDrafts(); render(); }
function exportDrafts() { const payload = { generatedAt: new Date().toISOString(), version:'local-review-drafts-v0.1', rows: rows.filter((row) => drafts[rowKey(row)]).map(draftPayload), safety: { localDraftOnly:true, payloadWrite:false, postgresqlWrite:false, importerAction:false, applyAllowedRows:0 } }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'local-review-drafts-v01.json'; a.click(); URL.revokeObjectURL(url); }
function draftTime(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; }
function importPayload(payload) { const inputRows = Array.isArray(payload?.rows) ? payload.rows : []; let imported = 0; let skipped = 0; let overwritten = 0; for (const row of inputRows) { const key = String(row.combinedQueueId || '').trim(); if (!key || !rowIds.has(key)) { skipped += 1; continue; } const incoming = { reviewDecision: String(row.reviewDecision || '').trim(), note: String(row.note || ''), updatedAt: String(row.updatedAt || new Date().toISOString()) }; if (!incoming.reviewDecision && !incoming.note) { skipped += 1; continue; } const current = drafts[key]; if (current) overwritten += 1; if (!current || draftTime(incoming.updatedAt) >= draftTime(current.updatedAt)) drafts[key] = incoming; imported += 1; } saveDrafts(); el.importStatus.textContent = '导入状态：导入 ' + imported + ' 行，覆盖 ' + overwritten + ' 行，跳过 ' + skipped + ' 行。'; render(); }
async function importDraftFile(file) { try { const payload = JSON.parse(await file.text()); importPayload(payload); } catch (error) { el.importStatus.textContent = '导入失败：' + String(error?.message || error); } finally { el.importFile.value = ''; } }
async function copyText(text, button) { try { await navigator.clipboard.writeText(text); const old = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = old; }, 900); } catch { window.prompt('复制这段内容：', text); } }
function render() { el.q.value = state.q; el.priority.value = state.priority; el.queueSource.value = state.queueSource; el.issueType.value = state.issueType; el.pageSize.value = String(state.pageSize); el.hideTitleSamples.checked = state.hideTitleSamples; el.onlyDrafts.classList.toggle('active', state.onlyDrafts); const filtered = filteredRows(); const page = filtered.slice(0, state.pageSize); el.totalRows.textContent = rows.length; el.visibleRows.textContent = filtered.length; el.draftRows.textContent = Object.keys(drafts).length; el.p1Rows.textContent = rows.filter((row) => row.priority === 'P1').length; el.p2Rows.textContent = rows.filter((row) => row.priority === 'P2').length; el.p3Rows.textContent = rows.filter((row) => row.priority === 'P3').length; el.resultNote.textContent = filtered.length > page.length ? '当前匹配 ' + filtered.length + ' 行，仅显示前 ' + page.length + ' 行。' : '当前匹配 ' + filtered.length + ' 行。'; el.tbody.innerHTML = page.map((row, index) => { const key = rowKey(row); const source = [row.sourceName, row.sourceId].filter(Boolean).join(':'); const candidate = [row.candidateClass, row.candidateType].filter(Boolean).join(' / '); const safety = row.reviewOnly && !row.applyAllowed ? 'reviewOnly · applyAllowed=false' : 'CHECK'; const savedClass = drafts[key] ? ' saved' : ''; return \`<tr data-priority="\${escapeHtml(row.priority)}" class="\${savedClass}"><td><span class="chip">\${escapeHtml(row.priority)}</span></td><td><span class="chip">\${escapeHtml(row.queueSource)}</span></td><td class="mono">\${escapeHtml(row.issueType)}</td><td><div class="title">\${escapeHtml(row.title || row.normalizedTitle)}</div><div class="muted mono">\${escapeHtml(row.combinedQueueId)}</div></td><td class="mono">\${escapeHtml(source || row.sourceRecordKey)}<button class="copy" data-copy-index="\${index}">复制 ID</button></td><td><div>\${escapeHtml(candidate)}</div><div class="muted mono">\${escapeHtml(row.candidateId || row.groupId || '')}</div></td><td class="mono">\${escapeHtml(row.score)}</td><td><div class="row-actions">\${draftSelectHtml(row)}\${draftNoteHtml(row)}</div></td><td>\${escapeHtml(row.suggestedAction)}</td><td class="muted">\${escapeHtml(row.reviewReason)}</td><td><span class="chip">\${escapeHtml(safety)}</span></td></tr>\`; }).join(''); document.querySelectorAll('[data-draft-action]').forEach((select) => select.addEventListener('change', () => setDraft(select.dataset.draftAction, { reviewDecision: select.value }))); document.querySelectorAll('[data-draft-note]').forEach((textarea) => textarea.addEventListener('change', () => setDraft(textarea.dataset.draftNote, { note: textarea.value }))); document.querySelectorAll('[data-copy-index]').forEach((button) => { const row = page[Number(button.dataset.copyIndex)]; const text = [row.combinedQueueId, row.sourceName && row.sourceId ? row.sourceName + ':' + row.sourceId : '', row.sourceRecordKey, row.candidateId, row.groupId].filter(Boolean).join('\\n'); button.addEventListener('click', () => copyText(text, button)); }); }
addOptions(el.queueSource, unique('queueSource')); addOptions(el.issueType, unique('issueType'));
el.q.addEventListener('input', () => { state.q = el.q.value; render(); }); el.priority.addEventListener('change', () => { state.priority = el.priority.value; render(); }); el.queueSource.addEventListener('change', () => { state.queueSource = el.queueSource.value; render(); }); el.issueType.addEventListener('change', () => { state.issueType = el.issueType.value; render(); }); el.pageSize.addEventListener('change', () => { state.pageSize = Number(el.pageSize.value); render(); }); el.hideTitleSamples.addEventListener('change', () => { state.hideTitleSamples = el.hideTitleSamples.checked; render(); }); document.querySelectorAll('[data-priority]').forEach((button) => button.addEventListener('click', () => { state.priority = state.priority === button.dataset.priority ? '' : button.dataset.priority; render(); })); document.querySelectorAll('[data-source]').forEach((button) => button.addEventListener('click', () => { state.queueSource = state.queueSource === button.dataset.source ? '' : button.dataset.source; render(); })); el.onlyDrafts.addEventListener('click', () => { state.onlyDrafts = !state.onlyDrafts; render(); }); el.exportDrafts.addEventListener('click', exportDrafts); el.importDrafts.addEventListener('click', () => el.importFile.click()); el.importFile.addEventListener('change', () => { const file = el.importFile.files?.[0]; if (file) importDraftFile(file); }); el.clearDrafts.addEventListener('click', () => { if (!confirm('确认清空浏览器里的本地复核草稿？不会影响仓库和数据库。')) return; drafts = {}; saveDrafts(); render(); }); el.reset.addEventListener('click', () => { Object.assign(state, { q:'', priority:'', queueSource:'', issueType:'', pageSize:100, hideTitleSamples:false, onlyDrafts:false }); render(); }); render();
</script>
</body>
</html>`
}

async function main() {
  const queuePath = arg('queue', QUEUE)
  const summaryPath = arg('summary', SUMMARY)
  const outPath = arg('out', OUT)

  for (const file of [queuePath, summaryPath]) {
    if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  }

  const queue = await readJsonl(queuePath)
  const summary = readJson(summaryPath, {})
  const rows = queue.rows.map(compactRow)

  const safety = {
    readOnly: true,
    payloadRead: false,
    payloadWrite: false,
    postgresqlWrite: false,
    importerAction: false,
    applyAllowedRows: rows.filter((row) => row.applyAllowed).length,
    notReviewOnlyRows: rows.filter((row) => row.reviewOnly !== true).length,
  }

  const report = {
    generatedAt: new Date().toISOString(),
    version: 'local-review-page-v0.4',
    queueRowsRead: queue.read,
    queueRowsFailed: queue.failed,
    htmlRows: rows.length,
    combinedSummary: summary,
    safety,
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, html(report, rows), 'utf8')

  console.log(JSON.stringify({ ok: true, report, outputs: { html: outPath } }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
