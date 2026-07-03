#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const outDir = path.join('data_local', 'import_ready')
const outPath = path.join(outDir, 'radar-policy-foundation-v01.payload.json')

function paragraph(text) {
  return {
    type: 'paragraph',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      {
        type: 'text',
        text,
        version: 1,
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
      },
    ],
  }
}

function richText(lines) {
  return {
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: null,
      children: lines.filter(Boolean).map(paragraph),
    },
  }
}

function rule({ title, slug, siteId, category, lines, status = 'published', isLiteVisible = true, isFullVisible = true }) {
  return {
    title,
    slug,
    siteId,
    category,
    isLiteVisible,
    isFullVisible,
    body: richText(lines),
    searchText: [title, slug, siteId, category, ...lines].join('\n'),
    status,
  }
}

function term({ name, slug, siteId, lines, status = 'published' }) {
  return {
    name,
    slug,
    siteId,
    isLiteVisible: true,
    isFullVisible: true,
    definition: richText(lines),
    searchText: [name, slug, siteId, ...lines].join('\n'),
    status,
  }
}

function warning({ name, slug, siteId, severity, category, lines }) {
  return {
    name,
    slug,
    siteId,
    severity,
    category,
    description: richText(lines),
  }
}

const rules = [
  rule({
    title: '排雷等级规则 v0.2',
    slug: 'radar-rating-policy-v02',
    siteId: 'rule-radar-rating-policy-v02',
    category: 'ranking',
    lines: [
      '本规则用于说明本站排雷等级、排雷类别和公开展示口径。',
      '当前政策版本：radar-rating-policy-v0.2-draft。',
      '等级顺序：S / A / B / C / D / E / F / X。',
      'S：无争议核心百合。A：安心推荐。B：轻度条件推荐。C：有条件推荐。',
      'D：非核心百合、分区作品或强不确定；其中 D-UNCLEAR 表示资料不足或证据不足。',
      'E：重度排雷。F：高危排雷。X：严重欺诈或黑名单。',
      '自动建议不得覆盖人工复核结果。F / X 不应由自动流程直接公开发布。',
      'AI 综合内容必须显示“AI 综合，待复核”。不要使用“最终评级 / final rating / permanent”等表述。',
    ],
  }),
  rule({
    title: '来源优先级规则 v0.1',
    slug: 'source-priority-policy-v01',
    siteId: 'rule-source-priority-policy-v01',
    category: 'principle',
    status: 'published',
    isLiteVisible: false,
    isFullVisible: true,
    lines: [
      '本规则用于导入、合并和冲突处理。',
      '来源优先级：Yurizukan, Bangumi, MangaDex, NDL, Steam, Wikidata, AniList。',
      '当不同来源产生冲突时，优先采用顺序靠前的来源。',
      '顺序靠后的冲突信息不得自动覆盖前者，应保留为复核证据并进入 review queue。',
      'Wikidata 只作为身份、外部 ID 和合并辅助证据，不作为排雷评级、成人内容判断或公开警告来源。',
      'AniList 是大规模候选池，不应覆盖更靠前来源。',
    ],
  }),
  rule({
    title: '页面警示模板说明 v0.1',
    slug: 'public-warning-template-policy-v01',
    siteId: 'rule-public-warning-template-policy-v01',
    category: 'editorial',
    lines: [
      '页面警示模板用于在读者进入页面时提前提示可能的不适内容、资料不足或身份冲突。',
      '模板应像旧 Wiki 的提示框一样醒目，但文字应尽量清楚、克制、可复核。',
      '资料不足、外部资料源、AI 综合、身份冲突、成人内容提示与关系排雷提示应分开显示。',
      '成人可见性提示和百合关系排雷等级分开处理。',
      '警示模板不等于最终结论，必要时应引导用户查看证据材料或帮助补充资料。',
    ],
  }),
]

const terms = [
  term({
    name: 'AI 综合，待复核',
    slug: 'ai-synthesized-pending-review',
    siteId: 'term-ai-synthesized-pending-review',
    lines: [
      '表示页面中的部分排雷信息由 AI 根据现有材料综合整理，尚未完成人工复核。',
      '公开页面必须明确显示此提示，避免用户将其误认为最终结论。',
    ],
  }),
  term({
    name: '资料不足，待补充',
    slug: 'insufficient-information',
    siteId: 'term-insufficient-information',
    lines: [
      '表示当前条目资料不完整，无法给出稳定判断。',
      '这类条目可使用 D-UNCLEAR 或“尚待复核”的展示状态，并鼓励用户补充剧情、角色关系、雷点与来源依据。',
    ],
  }),
  term({
    name: '外部资料源，待复核',
    slug: 'external-source-pending-review',
    siteId: 'term-external-source-pending-review',
    lines: [
      '表示条目的标题、身份、外部 ID 或部分基础信息来自外部资料源。',
      '外部资料源不自动等同于本站复核结果，也不能直接作为排雷依据。',
    ],
  }),
  term({
    name: '身份匹配冲突',
    slug: 'identity-conflict',
    siteId: 'term-identity-conflict',
    lines: [
      '表示同一条目在标题、外部 ID、来源链接或候选实体之间存在冲突。',
      '身份冲突应进入人工复核队列，不应自动覆盖已有资料。',
    ],
  }),
  term({
    name: 'D-UNCLEAR',
    slug: 'd-unclear',
    siteId: 'term-d-unclear',
    lines: [
      '排雷等级规则 v0.2 中的 D 级类别，表示过于抽象、资料不足或证据不足。',
      'D-UNCLEAR 不是 E 级重雷，也不是安全确认；它表示当前无法稳定判断，需要补充资料或人工复核。',
    ],
  }),
  term({
    name: '重度排雷',
    slug: 'heavy-radar',
    siteId: 'term-heavy-radar',
    lines: [
      '通常对应 E 级类别，表示作品中存在明显影响百合观看体验的重度雷点。',
      '例如男性亲密接触雷、前男友或过去男性恋爱雷、男性替身雷、路线污染雷、官方否认百合等。',
    ],
  }),
  term({
    name: '高危排雷',
    slug: 'high-risk-radar',
    siteId: 'term-high-risk-radar',
    lines: [
      '通常对应 F 级类别，表示作品中存在男性结婚或生子结局、男性 NTR、官方百合欺诈、设定欺诈等高危雷点。',
      'F 级自动建议不应直接公开发布，应经过人工复核。',
    ],
  }),
  term({
    name: '成人内容提示',
    slug: 'adult-visibility-warning',
    siteId: 'term-adult-visibility-warning',
    lines: [
      '用于提示成人向、性描写或其他不适合所有读者的内容。',
      '成人内容提示和百合关系排雷等级分开处理。',
    ],
  }),
  term({
    name: 'TS / 变百',
    slug: 'ts-transformation-yuri',
    siteId: 'term-ts-transformation-yuri',
    lines: [
      '指涉及性别转换、变身或类似设定的百合作品分区。',
      '在排雷等级规则 v0.2 中通常作为 D-TS 分区作品处理，具体体验视读者偏好而定。',
    ],
  }),
  term({
    name: '扶她',
    slug: 'futa',
    siteId: 'term-futa',
    lines: [
      '指包含扶她设定的作品分区。',
      '在排雷等级规则 v0.2 中通常作为 D-FUTA 分区作品处理，成人可见性提示应单独标注。',
    ],
  }),
  term({
    name: 'ABO',
    slug: 'abo',
    siteId: 'term-abo',
    lines: [
      '指 Alpha / Beta / Omega 相关设定分区。',
      '在排雷等级规则 v0.2 中通常作为 D-ABO 分区作品处理。',
    ],
  }),
  term({
    name: '女装少年 / 男の娘',
    slug: 'crossdressing-otokonoko',
    siteId: 'term-crossdressing-otokonoko',
    lines: [
      '指女装少年、男の娘或性别表现暧昧相关分区。',
      '在排雷等级规则 v0.2 中通常作为 D-CROSSDRESSING 分区作品处理。',
    ],
  }),
  term({
    name: '泛 LGBTQ+ 非核心百合',
    slug: 'queer-general-non-core-yuri',
    siteId: 'term-queer-general-non-core-yuri',
    lines: [
      '表示作品包含泛 LGBTQ+ 主题，但并非核心百合关系主线。',
      '在排雷等级规则 v0.2 中通常作为 D-QUEER-GENERAL 处理。',
    ],
  }),
]

const warnings = [
  warning({
    name: '资料不足，待补充',
    slug: 'info-insufficient',
    siteId: 'warning-info-insufficient',
    severity: 'low',
    category: 'operation',
    lines: [
      '此页面资料仍不完整，部分信息来自外部资料源，尚待人工复核。',
      '如果您了解这部作品，欢迎补充剧情、角色关系、雷点与来源依据。',
    ],
  }),
  warning({
    name: '外部资料源，待复核',
    slug: 'external-source-pending-review',
    siteId: 'warning-external-source-pending-review',
    severity: 'low',
    category: 'operation',
    lines: [
      '此条目的部分标题、身份或来源信息来自外部资料源。',
      '外部来源只作为身份与检索辅助，不代表本站已经完成排雷复核。',
    ],
  }),
  warning({
    name: 'AI 综合，待复核',
    slug: 'ai-synthesized-pending-review',
    siteId: 'warning-ai-synthesized-pending-review',
    severity: 'medium',
    category: 'operation',
    lines: [
      '本页面的部分排雷信息来自 AI 综合整理，尚待人工复核。',
      '请不要将其视为最终结论。',
    ],
  }),
  warning({
    name: '身份匹配存在冲突',
    slug: 'identity-conflict',
    siteId: 'warning-identity-conflict',
    severity: 'medium',
    category: 'operation',
    lines: [
      '此条目在外部 ID、标题或来源之间存在冲突，暂不自动覆盖已有资料。',
      '请以人工复核结果为准。',
    ],
  }),
  warning({
    name: '重度排雷提示',
    slug: 'heavy-radar-warning',
    siteId: 'warning-heavy-radar-warning',
    severity: 'high',
    category: 'relationship',
    lines: [
      '本页面可能包含会影响百合观看体验的重度关系雷点。',
      '继续阅读前请留意具体条目说明。',
    ],
  }),
  warning({
    name: '高危排雷提示',
    slug: 'high-risk-radar-warning',
    siteId: 'warning-high-risk-radar-warning',
    severity: 'critical',
    category: 'relationship',
    lines: [
      '本页面可能包含男性结局、男性 NTR、官方百合欺诈等高危内容。',
      '请谨慎阅读。',
    ],
  }),
  warning({
    name: '成人内容提示',
    slug: 'adult-visibility-warning',
    siteId: 'warning-adult-visibility-warning',
    severity: 'high',
    category: 'content',
    lines: [
      '本页面可能涉及成人向、性描写或其他不适合所有读者的内容。',
      '成人可见性提示与百合关系排雷等级分开处理。',
    ],
  }),
]

const seed = {
  generatedAt: new Date().toISOString(),
  seedId: 'radar-policy-foundation-v01',
  safety: {
    payloadWrite: false,
    postgresqlWrite: false,
    importer: false,
    productionDataChange: false,
  },
  rules,
  terms,
  warnings,
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(seed, null, 2), 'utf8')

console.log(JSON.stringify({
  ok: true,
  outPath,
  counts: {
    rules: rules.length,
    terms: terms.length,
    warnings: warnings.length,
  },
}, null, 2))

