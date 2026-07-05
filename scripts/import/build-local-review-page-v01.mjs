#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const QUEUE = 'data_local/staging/review/combined-review-queue-v01.jsonl'
const SUMMARY = 'data_local/staging/review/combined-review-queue-v01-summary.json'
const OUT = 'data_local/staging/review/local-review-page-v01.html'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

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
    sourceUrl: row.sourceUrl ?? '',
    sourceRecordKey: row.sourceRecordKey ?? '',
    candidateId: row.candidateId ?? '',
    groupId: row.groupId ?? '',
    candidateClass: row.candidateClass ?? '',
    candidateType: row.candidateType ?? '',
    score: row.score ?? '',
    memberCount: row.memberCount ?? '',
    reviewReason: row.reviewReason ?? '',
    suggestedAction: row.suggestedAction ?? '',
    reviewOnly: row.reviewOnly === true,
    applyAllowed: row.applyAllowed === true,
  }
}

function html(summary, rows, generatedAt) {
  const dataJson = JSON.stringify(rows)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')

  const summaryJson = JSON.stringify(summary, null, 2)

  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <title>百合排雷本地 Review Queue v0.1</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7fb;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --line: #e5e7eb;
      --p1: #fee2e2;
      --p2: #fef3c7;
      --p3: #dbeafe;
      --chip: #eef2ff;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --line: #374151;
        --p1: #4c1d1d;
        --p2: #463512;
        --p3: #172554;
        --chip: #1e1b4b;
      }
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
    }

    header {
      padding: 24px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 3;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }

    .subtitle {
      color: var(--muted);
      font-size: 14px;
    }

    main {
      padding: 20px 24px 40px;
      max-width: 1600px;
      margin: 0 auto;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .card, .filters, .table-wrap, details {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }

    .card {
      padding: 14px;
    }

    .card .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }

    .card .value {
      font-size: 22px;
      font-weight: 700;
    }

    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      padding: 14px;
      margin-bottom: 16px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }

    input, select, button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--bg);
      color: var(--text);
      font: inherit;
    }

    button {
      cursor: pointer;
      background: var(--chip);
      font-weight: 600;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1200px;
    }

    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px;
      vertical-align: top;
      text-align: left;
      font-size: 13px;
    }

    th {
      position: sticky;
      top: 112px;
      background: var(--panel);
      z-index: 2;
      font-size: 12px;
      color: var(--muted);
    }

    tr[data-priority="P1"] { background: var(--p1); }
    tr[data-priority="P2"] { background: var(--p2); }
    tr[data-priority="P3"] { background: var(--p3); }

    .mono {
      font-family: var(--mono);
      font-size: 12px;
    }

    .muted {
      color: var(--muted);
    }

    .title {
      font-weight: 700;
    }

    .action {
      max-width: 420px;
    }

    .reason {
      max-width: 420px;
      color: var(--muted);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      display: inline-flex;
      border-radius: 999px;
      background: var(--chip);
      padding: 3px 8px;
      font-size: 12px;
      white-space: nowrap;
    }

    details {
      padding: 12px 14px;
      margin-top: 16px;
    }

    pre {
      overflow: auto;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.5;
    }

    .empty {
      padding: 30px;
      text-align: center;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <header>
    <h1>百合排雷本地 Review Queue v0.1</h1>
    <div class="subtitle">
      生成时间：${esc(generatedAt)} · 本页面只读 · 不写 Payload / PostgreSQL · 不执行 importer
    </div>
  </header>

  <main>
    <section class="cards">
      <div class="card"><div class="label">combinedRows</div><div class="value" id="totalRows">0</div></div>
      <div class="card"><div class="label">当前筛选结果</div><div class="value" id="visibleRows">0</div></div>
      <div class="card"><div class="label">P1</div><div class="value" id="p1Rows">0</div></div>
      <div class="card"><div class="label">P2</div><div class="value" id="p2Rows">0</div></div>
      <div class="card"><div class="label">P3</div><div class="value" id="p3Rows">0</div></div>
    </section>

    <section class="filters">
      <label>
        关键词
        <input id="q" type="search" placeholder="标题 / sourceId / issueType / reason">
      </label>

      <label>
        Priority
        <select id="priority">
          <option value="">全部</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
      </label>

      <label>
        Source
        <select id="queueSource">
          <option value="">全部</option>
        </select>
      </label>

      <label>
        Issue Type
        <select id="issueType">
          <option value="">全部</option>
        </select>
      </label>

      <label>
        每页数量
        <select id="pageSize">
          <option value="50">50</option>
          <option value="100" selected>100</option>
          <option value="250">250</option>
          <option value="500">500</option>
        </select>
      </label>

      <button id="reset">清空筛选</button>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Priority</th>
            <th>Source</th>
            <th>Issue</th>
            <th>Title</th>
            <th>Source ID</th>
            <th>Candidate</th>
            <th>Score</th>
            <th>Suggested Action</th>
            <th>Reason</th>
            <th>Safety</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div id="empty" class="empty" hidden>没有匹配的 review row。</div>
    </section>

    <details>
      <summary>Summary JSON</summary>
      <pre>${esc(summaryJson)}</pre>
    </details>
  </main>

  <script>
    const rows = ${dataJson};

    const state = {
      q: '',
      priority: '',
      queueSource: '',
      issueType: '',
      pageSize: 100,
    };

    const el = {
      q: document.querySelector('#q'),
      priority: document.querySelector('#priority'),
      queueSource: document.querySelector('#queueSource'),
      issueType: document.querySelector('#issueType'),
      pageSize: document.querySelector('#pageSize'),
      reset: document.querySelector('#reset'),
      tbody: document.querySelector('#tbody'),
      empty: document.querySelector('#empty'),
      totalRows: document.querySelector('#totalRows'),
      visibleRows: document.querySelector('#visibleRows'),
      p1Rows: document.querySelector('#p1Rows'),
      p2Rows: document.querySelector('#p2Rows'),
      p3Rows: document.querySelector('#p3Rows'),
    };

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function unique(field) {
      return [...new Set(rows.map((row) => row[field]).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b)));
    }

    function addOptions(select, values) {
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
    }

    function rowText(row) {
      return [
        row.priority,
        row.queueSource,
        row.issueType,
        row.title,
        row.normalizedTitle,
        row.sourceName,
        row.sourceId,
        row.sourceRecordKey,
        row.candidateClass,
        row.candidateType,
        row.reviewReason,
        row.suggestedAction,
      ].join(' ').toLowerCase();
    }

    function filteredRows() {
      const q = state.q.trim().toLowerCase();

      return rows.filter((row) => {
        if (state.priority && row.priority !== state.priority) return false;
        if (state.queueSource && row.queueSource !== state.queueSource) return false;
        if (state.issueType && row.issueType !== state.issueType) return false;
        if (q && !rowText(row).includes(q)) return false;
        return true;
      });
    }

    function render() {
      const filtered = filteredRows();
      const page = filtered.slice(0, state.pageSize);

      el.totalRows.textContent = rows.length;
      el.visibleRows.textContent = filtered.length;
      el.p1Rows.textContent = rows.filter((row) => row.priority === 'P1').length;
      el.p2Rows.textContent = rows.filter((row) => row.priority === 'P2').length;
      el.p3Rows.textContent = rows.filter((row) => row.priority === 'P3').length;

      el.empty.hidden = filtered.length !== 0;
      el.tbody.innerHTML = page.map((row) => {
        const source = [row.sourceName, row.sourceId].filter(Boolean).join(':');
        const candidate = [row.candidateClass, row.candidateType].filter(Boolean).join(' / ');
        const safety = row.reviewOnly && !row.applyAllowed ? 'reviewOnly · applyAllowed=false' : 'CHECK';

        return \`
          <tr data-priority="\${escapeHtml(row.priority)}">
            <td><span class="chip">\${escapeHtml(row.priority)}</span></td>
            <td><span class="chip">\${escapeHtml(row.queueSource)}</span></td>
            <td class="mono">\${escapeHtml(row.issueType)}</td>
            <td>
              <div class="title">\${escapeHtml(row.title || row.normalizedTitle)}</div>
              <div class="muted mono">\${escapeHtml(row.combinedQueueId)}</div>
            </td>
            <td class="mono">\${escapeHtml(source || row.sourceRecordKey)}</td>
            <td>
              <div>\${escapeHtml(candidate)}</div>
              <div class="muted mono">\${escapeHtml(row.candidateId || row.groupId || '')}</div>
            </td>
            <td class="mono">\${escapeHtml(row.score)}</td>
            <td class="action">\${escapeHtml(row.suggestedAction)}</td>
            <td class="reason">\${escapeHtml(row.reviewReason)}</td>
            <td><span class="chip">\${escapeHtml(safety)}</span></td>
          </tr>
        \`;
      }).join('');
    }

    addOptions(el.queueSource, unique('queueSource'));
    addOptions(el.issueType, unique('issueType'));

    el.q.addEventListener('input', () => {
      state.q = el.q.value;
      render();
    });

    el.priority.addEventListener('change', () => {
      state.priority = el.priority.value;
      render();
    });

    el.queueSource.addEventListener('change', () => {
      state.queueSource = el.queueSource.value;
      render();
    });

    el.issueType.addEventListener('change', () => {
      state.issueType = el.issueType.value;
      render();
    });

    el.pageSize.addEventListener('change', () => {
      state.pageSize = Number(el.pageSize.value);
      render();
    });

    el.reset.addEventListener('click', () => {
      state.q = '';
      state.priority = '';
      state.queueSource = '';
      state.issueType = '';
      state.pageSize = 100;
      el.q.value = '';
      el.priority.value = '';
      el.queueSource.value = '';
      el.issueType.value = '';
      el.pageSize.value = '100';
      render();
    });

    render();
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
    version: 'local-review-page-v0.1',
    queueRowsRead: queue.read,
    queueRowsFailed: queue.failed,
    htmlRows: rows.length,
    combinedSummary: summary,
    safety,
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, html(report, rows, report.generatedAt), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    report,
    outputs: {
      html: outPath,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
