export type PublicMediaMode = 'text' | 'enhanced'

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
    email: String(process.env['NEXT_PUBLIC_FEEDBACK_EMAIL'] || '').trim(),
    externalForm: String(process.env['NEXT_PUBLIC_FEEDBACK_FORM_URL'] || '').trim(),
    issueTracker: String(process.env['NEXT_PUBLIC_FEEDBACK_ISSUE_URL'] || '').trim(),
  }
}
