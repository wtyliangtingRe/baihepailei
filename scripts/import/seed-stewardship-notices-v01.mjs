#!/usr/bin/env node

const DEFAULTS = [
  ['terminology-page', '用语解释', 'terminology', 'note', 'low', '本页包含需要单独解释的站内用语或专有概念。'],
  ['ongoing-page', '连载中', 'operation', 'warning', 'medium', '本条目涉及仍在连载或持续更新的内容，分级和关系结论可能随新内容变化。'],
  ['neutral-stance', '保持中立', 'editorial', 'note', 'medium', '本条目涉及难以评定的立场或争议，请阅读来源与编辑说明，不要把站务整理等同于背书。'],
  ['creator-visited', '创作者已关注本条目', 'editorial', 'note', 'medium', '本条目曾受到相关创作者或机构关注；编辑与讨论仍应遵守相同证据标准。'],
  ['final-adjudication', '最终站务裁决', 'editorial', 'black-banner', 'critical', '本条目存在长期争议，当前页面采用站务最终裁决；新的可靠证据仍可通过纠错流程提交。'],
  ['no-hype', '禁止炒作', 'editorial', 'warning', 'medium', '本站不承担宣传义务。条目应以可核验资料和排雷用途为主，避免营销式描述。'],
  ['info-insufficient', '资料不足', 'operation', 'note', 'low', '本条目资料仍然不足，欢迎补充剧情、角色关系、雷点和可追溯来源。'],
  ['external-source-pending-review', '外部资料待复核', 'identity', 'note', 'low', '部分标题、身份或来源信息来自外部资料，只作为检索辅助，仍需人工复核。'],
  ['ai-synthesized-pending-review', 'AI 综合待复核', 'transparency', 'warning', 'medium', '部分排雷信息来自 AI 综合整理，尚未等同于人工正式结论。'],
  ['identity-conflict', '条目身份存在冲突', 'identity', 'warning', 'high', '外部 ID、标题、版本或来源之间存在冲突，合并和正式结论应等待人工核实。'],
  ['needs-radar', '需要补充排雷', 'content', 'warning', 'medium', '本站对这部作品的关键关系、结局或创作者信息所知有限，需要更多可核验材料。'],
  ['heavy-radar-warning', '重度关系雷点提示', 'content', 'warning', 'high', '本页面可能包含会显著影响百合观看体验的重度关系雷点，请结合正式评级和证据阅读。'],
  ['high-risk-radar-warning', '高危排雷提示', 'content', 'danger', 'critical', '本页面可能涉及男性结局、男性 NTR、官方百合欺诈等高危内容，请谨慎查阅。'],
  ['adult-visibility-warning', '成人内容提示', 'content', 'warning', 'high', '本页面可能涉及成人向、性描写或其他不适合所有读者的内容。'],
  ['ideology-discomfort-warning', '价值观不适提示', 'content', 'black-banner', 'critical', '本页面可能包含严重违背人本主义、平权或基本尊严的内容，请酌情查阅。'],
].map(([slug, title, category, tone, severity, summary], index) => ({
  slug,
  title,
  category,
  tone,
  severity,
  summary,
  applicableCollections: ['works', 'creators', 'organizations'],
  sortOrder: (index + 1) * 10,
  isPublic: true,
}))

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.text()
  const payload = body ? JSON.parse(body) : null
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 1200)}`)
  return payload
}

async function main() {
  const baseUrl = String(arg('--url') || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const apply = process.argv.includes('--apply')
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login credentials in environment variables.')

  const login = await json(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const headers = { Authorization: `JWT ${login.token}` }
  const result = await json(`${baseUrl}/api/stewardship-notices?limit=200&depth=0`, { headers })
  const existing = new Map((result.docs || []).map((doc) => [doc.slug, doc]))
  const plan = DEFAULTS.map((notice) => ({
    action: existing.has(notice.slug) ? 'update' : 'create',
    id: existing.get(notice.slug)?.id,
    notice,
  }))

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: plan.length, plan: plan.map((row) => ({ action: row.action, id: row.id, slug: row.notice.slug, title: row.notice.title })) }, null, 2))
  if (!apply) {
    console.log('Dry-run only. Re-run with --apply after reviewing the plan.')
    return
  }

  for (const row of plan) {
    const url = row.action === 'create'
      ? `${baseUrl}/api/stewardship-notices`
      : `${baseUrl}/api/stewardship-notices/${row.id}`
    await json(url, {
      method: row.action === 'create' ? 'POST' : 'PATCH',
      headers,
      body: JSON.stringify(row.notice),
    })
    console.log(`${row.action}: ${row.notice.slug}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
