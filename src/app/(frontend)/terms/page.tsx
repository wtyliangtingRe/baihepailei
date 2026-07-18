import configPromise from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'

import { warningTemplates } from '@/lib/radar/warningTemplates'

export const dynamic = 'force-dynamic'

type NoticeCard = {
  id?: string | number
  slug?: string
  title?: string
  summary?: string
  category?: string
  tone?: string
  severity?: string
  helpUrl?: string
  sortOrder?: number
}

const categoryLabels: Record<string, string> = {
  operation: '站务状态',
  terminology: '用语解释',
  identity: '身份与版本',
  editorial: '编辑与裁量',
  content: '内容警示',
  transparency: '透明度说明',
  creator: '创作者提示',
  relationship: '关系提示',
  other: '其他提示',
}

const severityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '关键',
}

function fallbackNotices(): NoticeCard[] {
  return warningTemplates.map((template, index) => ({
    id: template.id,
    slug: template.id,
    title: template.title,
    summary: template.text,
    category: template.category,
    tone: template.style,
    severity: template.severity,
    sortOrder: index + 1,
  }))
}

async function publicNotices() {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'stewardship-notices' as never,
      depth: 0,
      limit: 200,
      pagination: false,
      overrideAccess: true,
      sort: 'sortOrder',
      where: { isPublic: { equals: true } },
    }) as unknown as { docs?: NoticeCard[] }
    const docs = (result.docs || []).filter((notice) => notice.title || notice.summary)
    return docs.length ? docs : fallbackNotices()
  } catch {
    return fallbackNotices()
  }
}

export default async function TermsIndexPage() {
  const notices = await publicNotices()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading site-guide-heading">
        <div>
          <p className="eyebrow">站点说明</p>
          <h1>站务与用语</h1>
          <p>这里集中说明页面性质、编辑立场、特殊状态与站务裁量。作品、创作者和机构可以按需关联零条、一条或多条提示；没有特殊情况时不会显示提示区块。</p>
        </div>
        <div className="collection-actions">
          <a className="back-link" href="#stewardship-language">查看站务提示</a>
          <Link className="back-link" href="/rules">排雷规则</Link>
          <Link className="back-link" href="/transparency">透明度报告</Link>
        </div>
      </section>

      <section className="rank-explainer">
        <div>
          <h2>站务提示不等于评级</h2>
          <p>提示负责说明身份争议、版本差异、特殊裁量、用语或阅读注意事项；正式分级仍由排雷规则、人工审核和证据材料决定。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/rules">打开完整分级细则</Link>
        </div>
      </section>

      <section className="ranked-collection-list" id="stewardship-language">
        <section className="rank-group">
          <div className="rank-group-heading">
            <div>
              <h2>可复用的站务与用语提示</h2>
              <p>这些提示由站务人员集中维护。之后新增提示不需要修改每个条目，也不需要重新写死页面组件。</p>
            </div>
          </div>
          <div className="collection-grid collection-grid-compact notice-template-grid">
            {notices.map((notice, index) => (
              <article className="collection-card collection-card-compact notice-template-card" key={String(notice.id || notice.slug || index)}>
                <div className="notice-template-copy">
                  <p>{categoryLabels[notice.category || ''] || '站务提示'}</p>
                  <h2>{notice.title || '未命名提示'}</h2>
                  {notice.summary ? <span>{notice.summary}</span> : null}
                  <span>样式：{notice.tone || 'note'} / 强度：{severityLabels[notice.severity || ''] || '低'}</span>
                  {notice.helpUrl ? <Link href={notice.helpUrl}>进一步说明</Link> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
