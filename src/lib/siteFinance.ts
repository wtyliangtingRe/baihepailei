export type FinanceEntry = {
  label: string
  amount: number
  date?: string
  note?: string
}

export type SiteFinanceReport = {
  configured: boolean
  period: string
  currency: string
  updatedAt?: string
  income: FinanceEntry[]
  expenses: FinanceEntry[]
  donation: {
    enabled: boolean
    label: string
    note: string
    qrImage?: string
  }
}

type RawFinanceReport = {
  period?: unknown
  currency?: unknown
  updatedAt?: unknown
  income?: unknown
  expenses?: unknown
  donation?: {
    enabled?: unknown
    label?: unknown
    note?: unknown
    qrImage?: unknown
  }
}

function text(value: unknown, max = 240) {
  return String(value ?? '').trim().slice(0, max)
}

function safeAmount(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function entries(value: unknown): FinanceEntry[] {
  if (!Array.isArray(value)) return []
  const output: FinanceEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const label = text(row.label, 120)
    const amount = safeAmount(row.amount)
    if (!label || amount === null) continue
    const date = text(row.date, 40)
    const note = text(row.note, 600)
    output.push({ label, amount, ...(date ? { date } : {}), ...(note ? { note } : {}) })
  }
  return output
}

function safeImage(value: unknown) {
  const image = text(value, 500)
  if (!image) return ''
  if (image.startsWith('/') && !image.startsWith('//')) return image
  if (/^https:\/\//iu.test(image)) return image
  return ''
}

function parseReport(): RawFinanceReport | null {
  const source = String(process.env['SITE_FINANCE_REPORT_JSON'] || '').trim()
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    return parsed && typeof parsed === 'object' ? parsed as RawFinanceReport : null
  } catch {
    return null
  }
}

export function readSiteFinanceReport(): SiteFinanceReport {
  const raw = parseReport()
  const income = entries(raw?.income)
  const expenses = entries(raw?.expenses)
  const envQr = process.env['SITE_DONATION_QR_IMAGE']
  const qrImage = safeImage(raw?.donation?.qrImage || envQr)
  const donationEnabled = raw?.donation?.enabled === true || Boolean(qrImage)

  return {
    configured: Boolean(raw),
    period: text(raw?.period, 100) || '尚未公开记账期间',
    currency: text(raw?.currency, 20) || 'TWD',
    updatedAt: text(raw?.updatedAt, 80) || undefined,
    income,
    expenses,
    donation: {
      enabled: donationEnabled,
      label: text(raw?.donation?.label, 120) || '支持网站持续运行',
      note: text(raw?.donation?.note, 800) || '捐赠完全自愿，不会影响作品评级、反馈处理顺序、账号权限或站务决定。',
      ...(qrImage ? { qrImage } : {}),
    },
  }
}
