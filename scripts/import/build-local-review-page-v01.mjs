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
  <title>百合排雷本地 Review Queue v0.2</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7fb;
      --panel: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --p1: #fee2e2;
      --p2: #fef3c7;
      --p3: #dbeafe;
      --chip: #eef2ff;
      --chip-strong: #e0e7ff;
      --button: #e9eefc;
      --button-active: #c7d2fe;
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
        --chip-strong: #312e81;
        --button: #1f2937;
        --button-active: #3730a3;
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
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--panel) 94%, transparent);
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(10px);
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
      padding: 18px 24px 40px;
      max-width: 1800px;
      margin: 0 auto;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .card, .filters, .quick, .table-wrap, details {
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

    .quick {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 14px;
      margin-bottom: 14px;
      align-items: center;
    }

    .quick .hint {
      color: var(--muted);
      font-size: 12px;
      margin-right: 4px;
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(260px, 1.3fr) repeat(4, minmax(150px, .8fr)) minmax(180px, .9fr);
      gap: 12px;
      padding: 14px;
      margin-bottom: 16px;
      align-items: end;
    }

    @media (max-width: 1200px) {
      .filters {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
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
      background: var(--button);
      font-weight: 650;
      transition: transform .08s ease, background .08s ease;
    }

    button:hover {
      transform: translateY(-1px);
    }

    button.active {
      background: var(--button-active);
    }

    .quick button {
      width: auto;
      padding: 8px 12px;
      font-size: 13px;
    }

    .checkbox {
      display: flex;
      gap: 8px;
      align-items: center;
      height: 42px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
    }

    .checkbox input {
      width: auto;
    }

    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 260px);
      min-height: 360px;
      position: relative;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      min-width: 1260px;
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 4;
      background: var(--panel);
      box-shadow: 0 1px 0 var(--line);
    }

    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px;
      vertical-align: top;
      text-align: left;
      font-size: 13px;
    }

    th {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }

    tbody tr[data-priority="P1"] { background: var(--p1); }
    tbody tr[data-priority="P2"] { background: var(--p2); }
    tbody tr[data-priority="P3"] { background: var(--p3); }

    tbody tr:hover {
      outline: 2px solid color-mix(in srgb, var(--button-active) 60%, transparent);
      outline-offset: -2px;
    }

    .mono {
      font-family: var(--mono);
      font-size: 12px;
      word-break: break-all;
    }

    .muted {
      color: var(--muted);
    }

    .title {
      font-weight: 750;
      margin-bottom: 4px;
    }

    .action {
      max-width: 420px;
    }

    .reason {
      max-width: 420px;
      color: var(--muted);
    }

    .chip {
      display: inline-flex;
      border-radius: 999px;
      background: var(--chip);
      padding: 3px 8px;
      font-size: 12px;
      white-space: nowrap;
    }

    .chip.strong {
      background: var(--chip-strong);
      font-weight: 700;
    }

    .copy {
      width: auto;
      padding: 4px 7px;
      border-radius: 8px;
      font-size: 11px;
      margin-top: 5px;
    }

    .result-note {
      color: var(--muted);
      font-size: 12px;
      margin: 0 0 10px 4px;
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
    <h1>百合排雷本地 Review Queue v0.2</h1>
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

    <section class="quick">
      <span class="hint">快速筛选：</span>
      <button data-quick-priority="P1">只看 P1</button>
      <button data-quick-priority="P2">只看 P2</button>
      <button data-quick-priority="P3">只看 P3</button>
      <button data-quick-source="identity">只看 identity</button>
      <button data-quick-source="work_graph">只看 work_graph</button>
      <button data-quick-issue="identity_possible_duplicate">identity possible duplicate</button>
      <button data-quick-issue="possible_duplicate_identity">work graph duplicate</button>
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
          <option value="1000">1000</option>
        </select>
      </label>

      <label>
        显示选项
        <span class="checkbox">
          <input id="hideTitleSamples" type="checkbox">
          隐藏 title_match 样本
        </span>
      </label>

      <button id="reset">清空筛选</button>
    </section>

    <p class="result-note" id="resultNote"></p>

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
      hideTitleSamples: false,
    };

    const el = {
      q: document.querySelector('#q'),
      priority: document.querySelector('#priority'),
      queueSource: document.querySelector('#queueSource'),
      issueType: document.querySelector('#issueType'),
      pageSize: document.querySelector('#pageSize'),
      hideTitleSamples: document.querySelector('#hideTitleSamples'),
      reset: document.querySelector('#reset'),
      tbody: document.querySelector('#tbody'),
      empty: document.querySelector('#empty'),
      resultNote: document.querySelector('#resultNote'),
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

    function isTitleMatchSample(row) {
      return row.issueType === 'identity_title_match_sample'
        || row.candidateType === 'title_match';
    }

    function filteredRows() {
      const q = state.q.trim().toLowerCase();

      return rows.filter((row) => {
        if (state.priority && row.priority !== state.priority) return false;
        if (state.queueSource && row.queueSource !== state.queueSource) return false;
        if (state.issueType && row.issueType !== state.issueType) return false;
        if (state.hideTitleSamples && isTitleMatchSample(row)) return false;
        if (q && !rowText(row).includes(q)) return false;
        return true;
      });
    }

    function syncControls() {
      el.q.value = state.q;
      el.priority.value = state.priority;
      el.queueSource.value = state.queueSource;
      el.issueType.value = state.issueType;
      el.pageSize.value = String(state.pageSize);
      el.hideTitleSamples.checked = state.hideTitleSamples;

      document.querySelectorAll('.quick button').forEach((button) => {
        const active = button.dataset.quickPriority === state.priority
          || button.dataset.quickSource === state.queueSource
          || button.dataset.quickIssue === state.issueType;
        button.classList.toggle('active', active);
      });
    }

    async function copyText(text, button) {
      try {
        await navigator.clipboard.writeText(text);
        const old = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = old; }, 900);
      } catch {
        window.prompt('复制这段内容：', text);
      }
    }

    function render() {
      syncControls();

      const filtered = filteredRows();
      const page = filtered.slice(0, state.pageSize);

      el.totalRows.textContent = rows.length;
      el.visibleRows.textContent = filtered.length;
      el.p1Rows.textContent = rows.filter((row) => row.priority === 'P1').length;
      el.p2Rows.textContent = rows.filter((row) => row.priority === 'P2').length;
      el.p3Rows.textContent = rows.filter((row) => row.priority === 'P3').length;

      el.resultNote.textContent = filtered.length > page.length
        ? \`当前匹配 \${filtered.length} 行，仅显示前 \${page.length} 行。可提高“每页数量”或继续筛选。\`
        : \`当前匹配 \${filtered.length} 行。\`;

      el.empty.hidden = filtered.length !== 0;
      el.tbody.innerHTML = page.map((row, index) => {
        const source = [row.sourceName, row.sourceId].filter(Boolean).join(':');
        const candidate = [row.candidateClass, row.candidateType].filter(Boolean).join(' / ');
        const safety = row.reviewOnly && !row.applyAllowed ? 'reviewOnly · applyAllowed=false' : 'CHECK';
        const copyId = row.candidateId || row.combinedQueueId || row.groupId || source || row.title || '';
        const copyButton = copyId
          ? \`<button class="copy" data-copy-index="\${index}">复制 ID</button>\`
          : '';

        return \`
          <tr data-priority="\${escapeHtml(row.priority)}">
            <td><span class="chip strong">\${escapeHtml(row.priority)}</span></td>
            <td><span class="chip">\${escapeHtml(row.queueSource)}</span></td>
            <td class="mono">\${escapeHtml(row.issueType)}</td>
            <td>
              <div class="title">\${escapeHtml(row.title || row.normalizedTitle)}</div>
              <div class="muted mono">\${escapeHtml(row.combinedQueueId)}</div>
            </td>
            <td class="mono">
              \${escapeHtml(source || row.sourceRecordKey)}
              \${copyButton}
            </td>
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

      document.querySelectorAll('[data-copy-index]').forEach((button) => {
        const row = page[Number(button.dataset.copyIndex)];
        const text = [
          row.combinedQueueId,
          row.sourceName && row.sourceId ? \`\${row.sourceName}:\${row.sourceId}\` : '',
          row.sourceRecordKey,
          row.candidateId,
          row.groupId,
        ].filter(Boolean).join('\\n');

        button.addEventListener('click', () => copyText(text, button));
      });
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

    el.hideTitleSamples.addEventListener('change', () => {
      state.hideTitleSamples = el.hideTitleSamples.checked;
      render();
    });

    document.querySelectorAll('[data-quick-priority]').forEach((button) => {
      button.addEventListener('click', () => {
        state.priority = state.priority === button.dataset.quickPriority ? '' : button.dataset.quickPriority;
        render();
      });
    });

    document.querySelectorAll('[data-quick-source]').forEach((button) => {
      button.addEventListener('click', () => {
        state.queueSource = state.queueSource === button.dataset.quickSource ? '' : button.dataset.quickSource;
        render();
      });
    });

    document.querySelectorAll('[data-quick-issue]').forEach((button) => {
      button.addEventListener('click', () => {
        state.issueType = state.issueType === button.dataset.quickIssue ? '' : button.dataset.quickIssue;
        render();
      });
    });

    el.reset.addEventListener('click', () => {
      state.q = '';
      state.priority = '';
      state.queueSource = '';
      state.issueType = '';
      state.pageSize = 100;
      state.hideTitleSamples = false;
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
    version: 'local-review-page-v0.2',
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
