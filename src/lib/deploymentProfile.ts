export type PublicMediaMode = 'text' | 'enhanced'

export function publicMediaMode(): PublicMediaMode {
  return String(process.env['NEXT_PUBLIC_MEDIA_MODE'] || '').trim().toLowerCase() === 'enhanced'
    ? 'enhanced'
    : 'text'
}

export function publicContentImagesEnabled() {
  return publicMediaMode() === 'enhanced'
}

export function publicFeedbackChannels() {
  return {
    email: String(process.env['NEXT_PUBLIC_FEEDBACK_EMAIL'] || process.env['SITE_OWNER_EMAIL'] || '').trim(),
    externalForm: String(process.env['NEXT_PUBLIC_FEEDBACK_FORM_URL'] || '').trim(),
    issueTracker: String(process.env['NEXT_PUBLIC_FEEDBACK_ISSUE_URL'] || '').trim(),
  }
}
