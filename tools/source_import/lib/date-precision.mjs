const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
const YEAR_MONTH = /^(\d{4})-(\d{2})$/u
const YEAR_ONLY = /^(\d{4})$/u
const UNKNOWN_LABELS = new Set(['', 'unknown', 'tba', 'n/a', 'na', '未定', '未知', '待定'])

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function parseDateWithPrecision(value) {
  const label = String(value ?? '').trim()
  const normalized = label.toLowerCase()

  if (UNKNOWN_LABELS.has(normalized)) {
    return { date: null, precision: 'unknown', label: label || '' }
  }

  const full = FULL_DATE.exec(label)
  if (full) {
    const year = Number(full[1])
    const month = Number(full[2])
    const day = Number(full[3])

    if (!isValidDateParts(year, month, day)) {
      return { date: null, precision: 'unknown', label }
    }

    return { date: `${year}-${pad(month)}-${pad(day)}`, precision: 'day', label }
  }

  const yearMonth = YEAR_MONTH.exec(label)
  if (yearMonth) {
    const year = Number(yearMonth[1])
    const month = Number(yearMonth[2])

    if (!isValidDateParts(year, month, 1)) {
      return { date: null, precision: 'unknown', label }
    }

    return { date: `${year}-${pad(month)}-01`, precision: 'month', label }
  }

  const yearOnly = YEAR_ONLY.exec(label)
  if (yearOnly) {
    const year = Number(yearOnly[1])
    return { date: `${year}-01-01`, precision: 'year', label }
  }

  return { date: null, precision: 'unknown', label }
}
