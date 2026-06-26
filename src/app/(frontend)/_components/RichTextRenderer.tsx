import React from 'react'

type RichNode = {
  type?: string
  text?: string
  tag?: string
  listType?: string
  url?: string
  format?: number | string | string[]
  children?: RichNode[]
  fields?: {
    url?: string
  }
}

type LegacyEntry =
  | { type: 'line'; value: string }
  | { type: 'warning'; lines: string[] }

type LegacyHeading = {
  level: number
  title: string
  rawTitle: string
  id: string
}

type LegacySection = {
  heading: LegacyHeading
  entries: LegacyEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toNode(value: unknown): RichNode | null {
  if (!isRecord(value)) return null
  return value as RichNode
}

function childNodes(value: unknown): RichNode[] {
  if (!Array.isArray(value)) return []
  return value.map(toNode).filter((node): node is RichNode => Boolean(node))
}

function rootChildren(content: unknown): RichNode[] {
  const node = toNode(content)
  if (!node) return []

  const root = toNode((content as { root?: unknown }).root)
  if (root?.children) return childNodes(root.children)
  return childNodes(node.children)
}

function nodePlainText(node: RichNode): string {
  if (typeof node.text === 'string') return node.text
  if (!node.children?.length) return ''

  const children = node.children.map(nodePlainText).filter(Boolean).join(' ')
  if (['paragraph', 'heading', 'quote', 'listitem'].includes(node.type || '')) return `${children}\n`
  return children
}

function nodesPlainText(nodes: RichNode[]) {
  return nodes.map(nodePlainText).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function hasFormat(format: RichNode['format'], name: string, bit: number) {
  if (typeof format === 'number') return Boolean(format & bit)
  if (typeof format === 'string') return format.split(' ').includes(name)
  if (Array.isArray(format)) return format.includes(name)
  return false
}

function safeHref(value: unknown) {
  if (typeof value !== 'string') return undefined
  if (value.startsWith('/') || value.startsWith('#')) return value

  try {
    const url = new URL(value)
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return value
  } catch {
    return undefined
  }

  return undefined
}

function renderTextNode(node: RichNode, key: React.Key) {
  let element: React.ReactNode = node.text || ''

  if (hasFormat(node.format, 'code', 16)) element = <code>{element}</code>
  if (hasFormat(node.format, 'bold', 1)) element = <strong>{element}</strong>
  if (hasFormat(node.format, 'italic', 2)) element = <em>{element}</em>
  if (hasFormat(node.format, 'underline', 8)) element = <u>{element}</u>
  if (hasFormat(node.format, 'strikethrough', 4)) element = <s>{element}</s>

  return <React.Fragment key={key}>{element}</React.Fragment>
}

function renderChildren(nodes: RichNode[] | undefined) {
  return (nodes || []).map((child, index) => renderNode(child, index))
}

function renderHeading(node: RichNode, key: React.Key) {
  const children = renderChildren(node.children)
  if (node.tag === 'h1') return <h2 key={key}>{children}</h2>
  if (node.tag === 'h3') return <h3 key={key}>{children}</h3>
  if (node.tag === 'h4') return <h4 key={key}>{children}</h4>
  return <h2 key={key}>{children}</h2>
}

function renderNode(node: RichNode, key: React.Key): React.ReactNode {
  if (node.type === 'text') return renderTextNode(node, key)

  if (node.type === 'root') {
    return <React.Fragment key={key}>{renderChildren(node.children)}</React.Fragment>
  }

  if (node.type === 'paragraph') {
    return <p key={key}>{renderChildren(node.children)}</p>
  }

  if (node.type === 'heading') return renderHeading(node, key)

  if (node.type === 'quote') {
    return <blockquote key={key}>{renderChildren(node.children)}</blockquote>
  }

  if (node.type === 'list') {
    const children = renderChildren(node.children)
    return node.listType === 'number' || node.tag === 'ol' ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>
  }

  if (node.type === 'listitem') {
    return <li key={key}>{renderChildren(node.children)}</li>
  }

  if (node.type === 'link' || node.type === 'autolink') {
    const href = safeHref(node.url || node.fields?.url)
    return href ? (
      <a href={href} key={key} rel="noreferrer" target={href.startsWith('/') || href.startsWith('#') ? undefined : '_blank'}>
        {renderChildren(node.children)}
      </a>
    ) : (
      <React.Fragment key={key}>{renderChildren(node.children)}</React.Fragment>
    )
  }

  if (node.children?.length) {
    return <React.Fragment key={key}>{renderChildren(node.children)}</React.Fragment>
  }

  return null
}

function plainTextParagraphs(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function looksLikeLegacyMarkup(text: string) {
  return /\{\{\/?\w+\}\}|\(%|\[\[.+?>>.+?\]\]|^\s*=+\s*.+?\s*=+\s*$/m.test(text)
}

function cleanLegacyText(text: string) {
  return text
    .replace(/\{\{velocity\}\}[\s\S]*?\{\{\/velocity\}\}/g, '')
    .replace(/\{\{warning\}\}/g, '\n{{warning}}\n')
    .replace(/\{\{\/warning\}\}/g, '\n{{/warning}}\n')
    .replace(/\(\(\(/g, '\n')
    .replace(/\)\)\)/g, '\n')
    .replace(/\s+(={1,6}\s*)/g, '\n$1')
    .replace(/\s+(\*\s*\(\(\()/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
}

function wikiHref(target: string) {
  const normalized = target.trim()
  const termMatch = normalized.match(/^doc:名词解释\.([^\.]+)\.WebHome$/)
  if (termMatch) return `/terms/${encodeURIComponent(termMatch[1])}`
  const ruleMatch = normalized.match(/^doc:排雷原则\.([^\.]+)\.WebHome$/)
  if (ruleMatch) return `/rules/${encodeURIComponent(ruleMatch[1])}`
  return undefined
}

function plainInlineText(value: string) {
  return value
    .replace(/\(%\s*style\s*=\s*"[^"]*"\s*%\)/g, '')
    .replace(/\(%%\)/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
}

function legacySlug(title: string, index: number) {
  const cleaned = plainInlineText(title)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `rule-${cleaned || index + 1}`
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const output: React.ReactNode[] = []
  const pattern = /\(%\s*style\s*=\s*"[^"]*color\s*:\s*([^;\"]+)[^"]*"\s*%\)([\s\S]*?)\(%%\)|\[\[(.*?)>>(.+?)\]\]|\*\*(.*?)\*\*/g
  let lastIndex = 0
  let index = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) output.push(plainInlineText(text.slice(lastIndex, match.index)))

    if (match[1]) {
      const color = match[1].trim()
      const inner = plainInlineText(match[2] || '')
      output.push(
        <strong className="xwiki-color-emphasis" data-color={color} key={`${keyPrefix}-color-${index}`}>
          {inner}
        </strong>,
      )
    } else if (match[3]) {
      const label = plainInlineText(match[3])
      const href = wikiHref(match[4] || '')
      output.push(
        href ? (
          <a href={href} key={`${keyPrefix}-link-${index}`}>
            {label}
          </a>
        ) : (
          <strong key={`${keyPrefix}-link-${index}`}>{label}</strong>
        ),
      )
    } else if (match[5]) {
      output.push(<strong key={`${keyPrefix}-bold-${index}`}>{plainInlineText(match[5])}</strong>)
    }

    lastIndex = pattern.lastIndex
    index += 1
  }

  if (lastIndex < text.length) output.push(plainInlineText(text.slice(lastIndex)))
  return output.filter((item) => item !== '')
}

function headingOf(line: string, index: number): LegacyHeading | null {
  const heading = line.trim().match(/^(={1,6})\s*(.*?)\s*=+$/)
  if (!heading) return null
  const rawTitle = heading[2].trim()
  const title = plainInlineText(rawTitle).trim()
  return {
    level: heading[1].length,
    title,
    rawTitle,
    id: legacySlug(title || rawTitle, index),
  }
}

function renderLegacyLine(line: string, key: React.Key, headingId?: string) {
  const keyText = String(key)
  const cleaned = line
    .replace(/^\s*\*+\s*/, '')
    .replace(/\(%\s*style\s*=\s*"(?![^"]*color)[^"]*"\s*%\)/g, '')
    .trim()

  if (!cleaned) return null

  const heading = cleaned.match(/^(={1,6})\s*(.*?)\s*=+$/)
  if (heading) {
    const level = heading[1].length
    const content = renderInline(heading[2], `h-${keyText}`)
    if (level <= 1) return <h2 id={headingId} key={key}>{content}</h2>
    if (level === 2) return <h3 id={headingId} key={key}>{content}</h3>
    return <h4 id={headingId} key={key}>{content}</h4>
  }

  if (/^\*+\s*/.test(line.trim())) {
    return <li key={key}>{renderInline(cleaned, `li-${keyText}`)}</li>
  }

  return <p key={key}>{renderInline(cleaned, `p-${keyText}`)}</p>
}

function renderLegacyEntry(entry: LegacyEntry, key: React.Key) {
  if (entry.type === 'warning') return renderLegacyBlock(entry.lines, key, true)
  return renderLegacyLine(entry.value, key)
}

function renderLegacyBlock(lines: string[], key: React.Key, warning = false) {
  const rendered = lines.map((line, index) => renderLegacyLine(line, `${String(key)}-${index}`)).filter(Boolean)
  if (rendered.length === 0) return null
  if (warning) return <aside className="xwiki-warning" key={key}>{rendered}</aside>
  return <React.Fragment key={key}>{rendered}</React.Fragment>
}

function legacyEntries(lines: string[]) {
  const entries: LegacyEntry[] = []
  let warningLines: string[] = []
  let inWarning = false

  for (const line of lines) {
    if (line === '{{warning}}') {
      inWarning = true
      warningLines = []
      continue
    }

    if (line === '{{/warning}}') {
      entries.push({ type: 'warning', lines: warningLines })
      inWarning = false
      warningLines = []
      continue
    }

    if (line.startsWith('{{') && line.endsWith('}}')) continue

    if (inWarning) warningLines.push(line)
    else entries.push({ type: 'line', value: line })
  }

  if (warningLines.length) entries.push({ type: 'warning', lines: warningLines })
  return entries
}

function splitLegacySections(entries: LegacyEntry[]) {
  const intro: LegacyEntry[] = []
  const sections: LegacySection[] = []
  let current: LegacySection | null = null
  let headingIndex = 0

  for (const entry of entries) {
    const heading = entry.type === 'line' ? headingOf(entry.value, headingIndex) : null
    if (heading) {
      current = { heading, entries: [] }
      sections.push(current)
      headingIndex += 1
      continue
    }

    if (current) current.entries.push(entry)
    else intro.push(entry)
  }

  return { intro, sections }
}

function renderLegacyToc(sections: LegacySection[]) {
  if (sections.length < 4) return null

  return (
    <nav className="xwiki-toc" aria-label="本页目录">
      <p>本页目录</p>
      <div>
        {sections.map((section) => (
          <a data-level={section.heading.level} href={`#${section.heading.id}`} key={section.heading.id}>
            {section.heading.title || '未命名章节'}
          </a>
        ))}
      </div>
    </nav>
  )
}

function renderLegacySection(section: LegacySection, index: number, fold: boolean) {
  if (!fold) {
    return (
      <React.Fragment key={section.heading.id}>
        {renderLegacyLine(`=${section.heading.rawTitle}=`, `heading-${section.heading.id}`, section.heading.id)}
        {section.entries.map((entry, entryIndex) => renderLegacyEntry(entry, `${section.heading.id}-${entryIndex}`))}
      </React.Fragment>
    )
  }

  return (
    <details className="xwiki-section" id={section.heading.id} key={section.heading.id} open={index < 2}>
      <summary>
        <span>{renderInline(section.heading.rawTitle, `summary-${section.heading.id}`)}</span>
      </summary>
      <div className="xwiki-section-body">
        {section.entries.map((entry, entryIndex) => renderLegacyEntry(entry, `${section.heading.id}-${entryIndex}`))}
      </div>
    </details>
  )
}

function renderLegacyMarkup(text: string) {
  const lines = cleanLegacyText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const entries = legacyEntries(lines)
  const { intro, sections } = splitLegacySections(entries)
  const fold = sections.length >= 4

  return (
    <div className="rich-text xwiki-rendered">
      {renderLegacyToc(sections)}
      {intro.map((entry, index) => renderLegacyEntry(entry, `intro-${index}`))}
      {sections.map((section, index) => renderLegacySection(section, index, fold))}
    </div>
  )
}

export default function RichTextRenderer({ content, fallback }: { content?: unknown; fallback?: string }) {
  if (typeof content === 'string') {
    if (looksLikeLegacyMarkup(content)) return renderLegacyMarkup(content)
    const paragraphs = plainTextParagraphs(content)
    if (paragraphs.length) {
      return (
        <div className="rich-text">
          {paragraphs.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      )
    }
  }

  const nodes = rootChildren(content)
  if (nodes.length) {
    const extractedText = nodesPlainText(nodes)
    if (looksLikeLegacyMarkup(extractedText)) return renderLegacyMarkup(extractedText)
    return <div className="rich-text">{renderChildren(nodes)}</div>
  }

  if (fallback && looksLikeLegacyMarkup(fallback)) return renderLegacyMarkup(fallback)

  const fallbackParagraphs = plainTextParagraphs(fallback || '')
  if (fallbackParagraphs.length === 0) return null

  return (
    <div className="rich-text">
      {fallbackParagraphs.map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
    </div>
  )
}
