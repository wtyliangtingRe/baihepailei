type RichNode = {
  type?: string
  text?: unknown
  children?: unknown[]
}

const blockTypes = new Set(['paragraph', 'heading', 'quote', 'listitem'])

function nodeText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const node = value as RichNode
  if (typeof node.text === 'string') return node.text
  if (node.type === 'linebreak') return '\n'
  if (!Array.isArray(node.children)) return ''

  const content = node.children.map(nodeText).join('')
  return blockTypes.has(String(node.type || '')) ? `${content}\n` : content
}

export function richTextToPlainText(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const fallback = (value as { plainText?: unknown }).plainText
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim()

  const root = (value as { root?: unknown }).root || value
  return nodeText(root)
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function textNode(text: string) {
  return {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  }
}

function paragraphNode(text: string) {
  return {
    children: text ? [textNode(text)] : [],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  }
}

export function plainTextToRichText(value: string) {
  const normalized = String(value || '').replace(/\r\n?/gu, '\n').trim()
  const lines = normalized ? normalized.split('\n') : []
  return {
    root: {
      children: lines.map(paragraphNode),
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}
