import Link from 'next/link'

import { warningTemplates } from '@/lib/radar/warningTemplates'

const categoryLabels: Record<string, string> = {
  content: '内容提示',
  relationship: '关系提示',
  creator: '创作者提示',
  operation: '站务提示',
  other: '其他提示',
}

const severityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键',
}

const noticeSections = [
  {
    id: 'site-language',
    title: '站务与用语',
    description: '用于说明页面性质、编辑立场、站点裁量和特殊状态。之后真正的“用语解释”也可以继续放到这个入口下面。',
    templateIds: ['terminology-page', 'ongoing-page', 'neutral-stance', 'creator-visited', 'final-adjudication', 'no-hype'],
  },
  {
    id: 'radar-help',
    title: '排雷协作',
    description: '用于提示资料不足、外部资料、AI 综合、匹配冲突，以及需要读者协助补充排雷证据的页面。',
    templateIds: ['info-insufficient', 'external-source-pending-review', 'ai-synthesized-pending-review', 'identity-conflict', 'needs-radar'],
  },
  {
    id: 'discomfort',
    title: '不适内容',
    description: '用于提示可能造成严重不适的内容。它们可以与排雷等级相关，但不替代具体评级和证据说明。',
    templateIds: ['heavy-radar-warning', 'high-risk-radar-warning', 'adult-visibility-warning', 'ideology-discomfort-warning'],
  },
]

function templateById(id: string) {
  return warningTemplates.find((template) => template.id === id)
}

export default function TermsIndexPage() {
  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading site-guide-heading">
        <p className="eyebrow">站点说明</p>
        <h1>站点说明</h1>
        <p>
          这里合并放置页面提示、用语解释入口与排雷规则入口。页面提示负责说明页面状态，排雷规则负责说明分级原则，用语解释之后可以继续扩展成概念说明页。
        </p>
        <div className="collection-actions">
          <a className="back-link" href="#site-language">站务与用语</a>
          <a className="back-link" href="#radar-help">排雷协作</a>
          <a className="back-link" href="#discomfort">不适内容</a>
          <Link className="back-link" href="/rules">排雷规则</Link>
          <Link className="back-link" href="/support">运营收支与支持</Link>
        </div>
      </section>

      <section className="rank-explainer">
        <div>
          <h2>排雷规则入口</h2>
          <p>
            S / A / B / C / D / E / F / X 的完整分级细则仍然保留在独立规则页。这里作为统一入口，避免顶部导航同时塞入太多相近按钮。
          </p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/rules">打开排雷规则</Link>
        </div>
      </section>

      <section className="ranked-collection-list">
        {noticeSections.map((section) => (
          <section className="rank-group" id={section.id} key={section.id}>
            <div className="rank-group-heading">
              <div>
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
              <span>{section.templateIds.length} 条</span>
            </div>
            <div className="collection-grid collection-grid-compact notice-template-grid">
              {section.templateIds.map((id) => {
                const template = templateById(id)
                if (!template) return null

                return (
                  <article className="collection-card collection-card-compact notice-template-card" key={template.id}>
                    <span aria-hidden="true" className="notice-template-icon notice-template-glyph">i</span>
                    <div className="notice-template-copy">
                      <p>{categoryLabels[template.category] || template.category}</p>
                      <h2>{template.title}</h2>
                      <span>{template.text}</span>
                      <span>样式：{template.style} / 强度：{severityLabels[template.severity] || template.severity}</span>
                      {template.relatedRatingClasses?.length ? (
                        <span>关联细则：{template.relatedRatingClasses.join('、')}</span>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </section>
    </main>
  )
}
