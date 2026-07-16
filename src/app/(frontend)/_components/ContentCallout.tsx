export type ContentCalloutImage = {
  url?: string
  alt?: string
  filename?: string
}

export type ContentCalloutItem = {
  id?: string
  style?: 'black-banner' | 'note' | 'warning' | 'image-text' | string
  title?: string
  text?: string
  quote?: string
  image?: ContentCalloutImage
  sourceLabel?: string
  sourceUrl?: string
}

function styleClass(style?: string) {
  if (style === 'black-banner') return 'content-callout black-banner'
  if (style === 'warning') return 'content-callout warning'
  if (style === 'image-text') return 'content-callout image-text'
  return 'content-callout note'
}

function styleLabel(style?: string) {
  if (style === 'black-banner') return '重点提示'
  if (style === 'warning') return '提示'
  if (style === 'image-text') return '图文提示'
  return '说明'
}

function CalloutImage({ image, title }: { image?: ContentCalloutImage; title?: string }) {
  if (!image?.url) return null
  return <figure className="content-callout-image"><img alt={image.alt || title || image.filename || '图文提示图片'} loading="lazy" src={image.url} /></figure>
}

export default function ContentCallout({ callout, showImage = false }: { callout: ContentCalloutItem; showImage?: boolean }) {
  const hasBody = callout.title || callout.text || callout.quote || callout.sourceUrl
  if (!hasBody && !(showImage && callout.image?.url)) return null

  return (
    <aside className={styleClass(callout.style)}>
      {showImage ? <CalloutImage image={callout.image} title={callout.title} /> : null}
      <div className="content-callout-body">
        <p className="content-callout-label">{styleLabel(callout.style)}</p>
        {callout.title ? <h2>{callout.title}</h2> : null}
        {callout.quote ? <blockquote>{callout.quote}</blockquote> : null}
        {callout.text ? <p>{callout.text}</p> : null}
        {callout.sourceUrl ? <a href={callout.sourceUrl} rel="noreferrer" target="_blank">{callout.sourceLabel || '查看来源'}</a> : null}
      </div>
    </aside>
  )
}
