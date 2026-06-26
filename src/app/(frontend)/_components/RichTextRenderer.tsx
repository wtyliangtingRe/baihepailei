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

function looksLikeXWiki(text: string) {
  return /\{\{\/?\w+\}\}|\(%|\[\[.+?>>.+?\]\]|^\s*=+\s*.+?\s*=+\s*$/m.test(text)
}

function cleanXWikiText(text: string) {
  return text
    .replace(/\{\{velocity\}\}[\s\S]*?\{\{\/velocity\}\}/g, '')
    .replace(/\{\{warning\}\}/g, '\n{{warning}}\n')
    .replace(/\{\{\/warning\}\}/g, '\n{{/warning}}\n')
    .replace(/\(\(\(/g, '\n')
    .replace(/\)\)\)/g, '\n')
    .replace(/\s+(={2,6}\s*)/g, '\n$1')
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
    .replace(/\(%\s*style="[^"]*"\s*%\)/g, '')
    .replace(/\(%%\)/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const output: React.ReactNode[] = []
  const pattern = /\(%\s*style="[^"]*color\s*:\s*([^;\"]+)[^"]*"\s*%\)([\s\S]*?)\(%%\)|\[\[(.*?)>>(.+?)\]\]|\*\*(.*?)\*\*/g
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

function renderXWikiLine(line: string, key: React.Key) {
  const cleaned = line
    .replace(/^\s*\*+\s*/, '')
    .replace(/\(%\s*style="(?![^"]*color)[^"]*"\s*%\)/g, '')
    .trim()

  if (!cleaned) return null

  const heading = cleaned.match(/^(={1,6})\s*(.*?)\s*=+$/)
  if (heading) {
    const level = heading[1].length
    const content = renderInline(heading[2], `h-${key}`)
    if (level <= 1) return <h2 key={key}>{content}</h2>
    if (level === 2) return <h3 key={key}>{content}</h3>
    return <h4 key={key}>{content}</h4>
  }

  if (/^\*+\s*/.test(line.trim())) {
    return <li key={key}>{renderInline(cleaned, `li-${key}`)}</li>
  }

  return <p key={key}>{renderInline(cleaned, `p-${key}`)}</p>
}

function renderXWikiBlock(lines: string[], key: React.Key, warning = false) {
  const rendered = lines.map((line, index) => renderXWikiLine(line, `${key}-${index}`)).filter(Boolean)
  if (rendered.length === 0) return null
  if (warning) return <aside className="xwiki-warning" key={key}>{rendered}</aside>
  return <React.Fragment key={key}>{rendered}</React.Fragment>
}

function renderXWiki(text: string) {
  const lines = cleanXWikiText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const blocks: React.ReactNode[] = []
  let warningLines: string[] = []
  let inWarning = false
  let normalLines: string[] = []

  function flushNormal() {
    if (normalLines.length) {
      blocks.push(renderXWikiBlock(normalLines, `normal-${blocks.length}`))
      normalLines = []
    }
  }

  for (const line of lines) {
    if (line === '{{warning}}') {
      flushNormal()
      inWarning = true
      warningLines = []
      continue
    }

    if (line === '{{/warning}}') {
      blocks.push(renderXWikiBlock(warningLines, `warning-${blocks.length}`, true))
      inWarning = false
      warningLines = []
      continue
    }

    if (line.startsWith('{{') && line.endsWith('}}')) continue

    if (inWarning) warningLines.push(line)
    else normalLines.push(line)
  }

  if (warningLines.length) blocks.push(renderXWikiBlock(warningLines, `warning-${blocks.length}`, true))
  flushNormal()

  return <div className="rich-text xwiki-rendered">{blocks}</div>
}

export default function RichTextRenderer({ content, fallback }: { content?: unknown; fallback?: string }) {
  if (typeof content === 'string') {
    if (looksLikeXWiki(content)) return renderXWiki(content)
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
    return <div className="rich-text">{renderChildren(nodes)}</div>
  }

  if (fallback && looksLikeXWiki(fallback)) return renderXWiki(fallback)

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
