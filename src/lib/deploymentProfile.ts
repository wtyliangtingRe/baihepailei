export type PublicMediaMode = 'text' | 'enhanced'

export const DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL =
  'https://github.com/wtyliangtingRe/baihepailei/issues/new'

function publicHttpsUrl(value: unknown, fallback = ''): string {
  const candidate = String(value || '').trim() || fallback
  if (!candidate) return ''

  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function publicEmail(value: unknown): string {
  const candidate = String(value || '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : ''
}

export function publicMediaMode(): PublicMediaMode {
  return String(process.env['NEXT_PUBLIC_MEDIA_MODE'] || '').trim().toLowerCase() === 'text'
    ? 'text'
    : 'enhanced'
}

export function publicContentImagesEnabled() {
  return publicMediaMode() === 'enhanced'
}

export function publicFeedbackChannels() {
  return {
    // Keep the owner login identity server-only. A public contact address must be
    // configured explicitly because every NEXT_PUBLIC value is browser-visible.
    email: publicEmail(process.env['NEXT_PUBLIC_FEEDBACK_EMAIL']),
    externalForm: publicHttpsUrl(process.env['NEXT_PUBLIC_FEEDBACK_FORM_URL']),
    // Always keep a real, authenticated submission path in local/default builds.
    // Deployments can point this at a dedicated public issues-only repository.
    issueTracker: publicHttpsUrl(
      process.env['NEXT_PUBLIC_FEEDBACK_ISSUE_URL'],
      DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL,
    ),
  }
}
