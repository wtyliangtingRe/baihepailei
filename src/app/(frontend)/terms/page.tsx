import { warningTemplates } from '@/lib/radar/warningTemplates'

const categoryLabels: Record<string, string> = {
  content: '内容提示',
  relationship: '关系提示',
  creator: '创作者提示',
  operation: '资料状态提示',
  other: '其他提示',
}

const severityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键',
}

export default function TermsIndexPage() {
  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">页面提示</p>
        <h1>页面提示</h1>
        <p>
          用于作品页、证据页和资料页的信息状态提示。它们负责标明“资料不足”“AI 综合，待复核”“高危排雷”等页面状态，不再作为排雷细则的条件标签重复展示。
        </p>
        <div className="collection-actions">
          <span>{warningTemplates.length} 个模板</span>
          <span>可继续扩展</span>
        </div>
      </section>

      <section className="collection-grid collection-grid-compact">
        {warningTemplates.map((template) => (
          <article className="collection-card collection-card-compact" key={template.id}>
            <p>{categoryLabels[template.category] || template.category}</p>
            <h2>{template.title}</h2>
            <span>{template.text}</span>
            <span>样式：{template.style} / 强度：{severityLabels[template.severity] || template.severity}</span>
            {template.relatedRatingClasses?.length ? (
              <span>关联细则：{template.relatedRatingClasses.join('、')}</span>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  )
}
