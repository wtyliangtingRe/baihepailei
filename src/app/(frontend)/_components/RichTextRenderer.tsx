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

export default function RichTextRenderer({ content, fallback }: { content?: unknown; fallback?: string }) {
  if (typeof content === 'string') {
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
