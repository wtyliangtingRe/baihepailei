'use strict'

const get = id => document.getElementById(id)
const data = JSON.parse(get('catalog-data').textContent)
const { works, rules, grades } = data
const worksById = new Map(works.map(work => [work.id, work]))
const gradeLabels = Object.fromEntries(grades.map(({ code, label }) => [code, label]))
const sources = {
  official: data.tags['source-official'].label,
  community: data.tags['source-community'].label,
}
const pageSize = 20
const formatNumber = new Intl.NumberFormat('zh-CN').format
const filters = get('filters')
const dialog = get('work-dialog')
let matched = works
let page = 1
let searchIndex

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function fillOptions(id, options) {
  for (const [value, label] of options) get(id).add(new Option(label, value))
}

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ').trim()
}

function searchable(work) {
  return normalize([
    work.title, ...work.aliases, work.media, work.mediaLabel, work.format,
    ...work.creators.flatMap(({ name, role }) => [name, role]),
    ...work.organizations.flatMap(({ name, role }) => [name, role]),
    ...work.tags.map(key => data.tags[key]?.label),
    ...work.classes.flatMap(code => [
      code, rules[code]?.label, rules[code]?.summary, ...(rules[code]?.searchTerms ?? []),
    ]),
  ].join(' '))
}

function search() {
  const query = normalize(get('query').value)
  const exactId = query.match(/^(?:work\s*)?(\d+)$/)?.[1]
  const exactWork = exactId && worksById.get(exactId)
  const grade = get('grade').value
  const media = get('media').value
  const source = get('source').value
  const progress = get('progress').value
  if (query && !exactWork) searchIndex ??= works.map(searchable)

  matched = (exactWork ? [exactWork] : works).filter((work, index) =>
    (!grade || work.grade === grade) &&
    (!media || work.media === media) &&
    (!source || work.source === source) &&
    (progress !== 'rated' || work.grade) &&
    (progress !== 'unrated' || !work.grade) &&
    (progress !== 'reviewed' || work.reviewed) &&
    (!query || exactWork || searchIndex[index].includes(query)),
  )
  page = 1
  drawPage()
}

function ratingChip(grade) {
  return element('span', 'rank rank-' + (grade || 'unrated'), grade || '待评')
}

function workCard(work) {
  const title = element('strong', '', work.title)
  const description = [work.mediaLabel, work.published, sources[work.source]].filter(Boolean)
  const topClass = rules[work.classes[0]]?.label
  const info = element('span', 'result-info')
  info.append(title, element('span', 'muted', description.join(' · ')))
  if (topClass) info.append(element('span', 'result-warning', topClass))

  const button = element('button', 'work-card')
  button.type = 'button'
  button.append(ratingChip(work.grade), info)
  button.addEventListener('click', () => showWork(work))
  const item = element('li')
  item.append(button)
  return item
}

function drawPage() {
  const pageTotal = Math.ceil(matched.length / pageSize)
  get('result-count').textContent = matched.length
    ? formatNumber(matched.length) + ' 条作品'
    : '没有找到符合条件的作品'
  get('results').replaceChildren(...matched.slice((page - 1) * pageSize, page * pageSize).map(workCard))
  get('pager').hidden = pageTotal < 2
  get('previous').disabled = page <= 1
  get('next').disabled = page >= pageTotal
  get('page-count').textContent = '第 ' + page + ' / ' + pageTotal + ' 页'
  get('page-number').max = Math.max(1, pageTotal)
  get('page-number').value = ''
}

function moveTo(value) {
  const pageTotal = Math.ceil(matched.length / pageSize)
  if (!Number.isInteger(value) || value < 1 || value > pageTotal || value === page) return
  page = value
  drawPage()
  const heading = get('result-count')
  heading.focus({ preventScroll: true })
  heading.scrollIntoView({ block: 'start' })
}

function externalLink(url, label) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    const link = element('a', '', label || parsed.hostname)
    link.href = parsed.href
    link.target = '_blank'
    link.rel = 'noreferrer'
    return link
  } catch {
    return null
  }
}

function listOf(items) {
  const list = element('ul')
  for (const item of items) {
    const row = element('li')
    row.append(item)
    list.append(row)
  }
  return list
}

function disclosure(title, children) {
  const details = element('details', 'disclosure')
  details.append(element('summary', '', title), ...children)
  return details
}

function appendLinks(parent, links) {
  const seen = new Set()
  const anchors = []
  for (const { url, title, kind } of links) {
    if (seen.has(url)) continue
    const link = externalLink(url, title || (sources[kind] && sources[kind] + ' · ' + url))
    if (!link) continue
    seen.add(url)
    anchors.push(link)
  }
  if (anchors.length) parent.append(listOf(anchors))
}

function showWork(work) {
  const detail = get('work-detail')
  const title = element('h2', '', work.title)
  title.id = 'work-title'
  const verdict = element('p', 'verdict')
  verdict.append(ratingChip(work.grade), element('strong', '', gradeLabels[work.grade] || data.statuses[work.state]))
  if (work.source) verdict.append(element('span', 'pill', sources[work.source]))
  const metadata = [work.mediaLabel, work.format, work.published].filter(Boolean)
  detail.replaceChildren(title, element('p', 'muted', [...new Set(metadata)].join(' · ')), verdict)

  if (work.aliases.length) detail.append(disclosure('译名与别名', [listOf(work.aliases)]))
  for (const [label, credits] of [['作者与主创', work.creators], ['创作与发行机构', work.organizations]]) {
    if (!credits.length) continue
    detail.append(disclosure(label, [listOf(credits.map(({ name, role }) => role ? name + ' · ' + role : name))]))
  }
  if (work.summary) detail.append(element('p', 'work-summary', work.summary))
  if (work.classes.length) {
    detail.append(element('h3', '', '评级细则'), listOf(work.classes.map(code =>
      code + (rules[code] ? ' · ' + rules[code].label : ''),
    )))
  }
  const warnings = work.tags.map(key => data.tags[key]).filter(tag => tag && tag.group !== '评级来源')
  if (warnings.length) detail.append(element('h3', '', '内容提示'), listOf(warnings.map(tag => tag.label)))
  if (work.rationale) detail.append(disclosure('评级依据（可能涉及剧透）', [
    element('p', 'work-rationale', work.rationale),
  ]))
  if (work.continuity?.length) {
    const related = work.continuity.flatMap(({ id, character }) => {
      const entry = worksById.get(id)
      if (!entry) return []
      const button = element('button', 'related-work', entry.title + (character ? ' · ' + character : ''))
      button.type = 'button'
      button.addEventListener('click', () => showWork(entry))
      return [button]
    })
    if (related.length) detail.append(element('h3', '', '关联的前后作'), listOf(related))
  }
  const evidence = disclosure('评级与作品来源', [])
  const findings = work.findings ?? []
  for (const { kind, grade, classes, urls } of findings) {
    evidence.append(element('p', '', [sources[kind], grade, classes?.join('、')].filter(Boolean).join(' · ')))
    appendLinks(evidence, urls.map(url => ({ url, kind })))
  }
  const findingUrls = new Set(findings.flatMap(finding => finding.urls))
  const extraLinks = [
    ...(work.evidence ?? []),
    ...(work.catalog ?? []),
    { url: work.summarySource, title: '简介来源' },
  ].filter(link => !findingUrls.has(link.url))
  appendLinks(evidence, extraLinks)
  if (evidence.children.length > 1) detail.append(evidence)

  const online = externalLink('https://baihepailei.com/works/w-' + encodeURIComponent(work.id), '打开在线作品页 ↗')
  const onlineRow = element('p', 'work-online')
  onlineRow.append(online)
  detail.append(onlineRow)
  if (!dialog.open) dialog.showModal()
  dialog.scrollTop = 0
  get('close-work').focus()
}

function renderRules() {
  const sections = []
  for (const grade of grades) {
    const section = element('section', 'panel rule-group')
    const heading = element('h2')
    heading.append(ratingChip(grade.code), element('span', '', grade.label))
    section.append(heading, element('p', 'muted', grade.summary))
    for (const [code, rule] of Object.entries(rules)) {
      if (rule.grade !== grade.code) continue
      const children = [element('p', '', rule.summary)]
      for (const [label, contents] of [
        ['纳入条件', rule.inclusionCriteria],
        ['排除条件', rule.exclusionCriteria],
        ['解释说明', rule.interpretationNotes],
      ]) {
        if (contents.length) children.push(element('h3', '', label), listOf(contents))
      }
      section.append(disclosure(code + ' · ' + rule.label, children))
    }
    sections.push(section)
  }
  get('rule-list').replaceChildren(...sections)
}

function updateView() {
  const showRules = location.hash === '#rules'
  get('catalog').hidden = showRules
  get('rules').hidden = !showRules
  get('catalog-tab').setAttribute('aria-current', showRules ? 'false' : 'page')
  get('rules-tab').setAttribute('aria-current', showRules ? 'page' : 'false')
}

get('snapshot').textContent = data.date + ' 快照 · 规则 ' + data.policy
get('rules-version').textContent = data.policy + ' · ' + Object.keys(rules).length + ' 条细则'
for (const [label, count] of [
  ['收录作品', data.counts.visible], ['已有评级', data.counts.rated], ['S / A 级', data.counts.safe],
]) {
  const stat = element('div')
  stat.append(element('strong', '', formatNumber(count)), element('span', '', label))
  get('stats').append(stat)
}

fillOptions('grade', grades.map(({ code, label }) => [code, code + ' · ' + label]))
fillOptions('media', Object.entries(data.media))
fillOptions('source', Object.entries(sources))
filters.addEventListener('submit', event => {
  event.preventDefault()
  search()
})
get('clear-filters').addEventListener('click', () => {
  filters.reset()
  search()
})
get('previous').addEventListener('click', () => moveTo(page - 1))
get('next').addEventListener('click', () => moveTo(page + 1))
get('page-jump').addEventListener('submit', event => {
  event.preventDefault()
  moveTo(get('page-number').valueAsNumber)
})
get('close-work').addEventListener('click', () => dialog.close())
window.addEventListener('hashchange', updateView)
renderRules()
updateView()
search()
