import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getFormalWorkLineageById } from '@/lib/work-lineage/runtimeRepository'

import { recordIdFromContentRoute } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type ExternalIdentity = {
  provider?: string
  namespace?: string
  externalId?: string
  providerIdentityKey?: string
}

type IdentityBinding = {
  bindingId?: string
  externalIdentity?: ExternalIdentity
  bindingState?: string
  verificationState?: string
  freshnessState?: string
  validityState?: string
  scopeMatch?: string
}

export default async function WorkDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workId = recordIdFromContentRoute('works', slug)
  if (!workId) notFound()

  let result: Awaited<ReturnType<typeof getFormalWorkLineageById>> | null = null
  try {
    result = await getFormalWorkLineageById(workId)
  } catch (error) {
    console.error('Formal WorkLineage detail failed', error)
    return (
      <main className="page collection-page">
        <section className="empty-state small">
          <h1>正式作品记录暂时不可用</h1>
          <p>系统不会回退到旧 Payload、旧详情索引或历史 Radar 数据。</p>
          <Link className="back-link" href="/works">返回作品列表</Link>
        </section>
      </main>
    )
  }
  if (!result) notFound()

  const document = result.document
  const identities = document.identities as {
    observation?: { state?: string; provenanceObservationRefs?: string[] }
    bindings?: IdentityBinding[]
  }
  const research = document.research as { observation?: { state?: string } }
  const assessment = document.assessment as { observation?: { state?: string } }
  const effectiveState = document.effectiveState as {
    ai?: { selection?: { currentConclusionState?: string; failClosed?: boolean } }
  }
  const provenance = document.provenance as {
    auditRunRef?: string
    summary?: { packageId?: string; legacyRuntimeDependency?: boolean }
  }
  const bindings = identities.bindings || []

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">正式 Frozen WorkLineage</p>
        <h1>{document.canonical.naming.canonicalTitle}</h1>
        <p>这是一条从自包含正式包导入的新数据库记录，不读取旧作品表、旧静态详情、参考包或历史评级。</p>
        <div className="work-card-badges">
          <span className="work-type-chip">Work {document.workId}</span>
          <span className="work-type-chip">身份 {identities.observation?.state || 'unknown'}</span>
          <span className="work-type-chip">当前结论 {effectiveState.ai?.selection?.currentConclusionState || 'unknown'}</span>
        </div>
        <div className="collection-actions"><Link className="back-link" href="/works">返回作品</Link></div>
      </section>

      <section className="detail-card">
        <h2>正式身份</h2>
        {bindings.length ? bindings.map((binding) => (
          <dl key={binding.bindingId}>
            <div><dt>提供方</dt><dd>{binding.externalIdentity?.provider || '未记录'}</dd></div>
            <div><dt>命名空间</dt><dd>{binding.externalIdentity?.namespace || '未记录'}</dd></div>
            <div><dt>外部 ID</dt><dd><code>{binding.externalIdentity?.externalId || '未记录'}</code></dd></div>
            <div><dt>绑定状态</dt><dd>{binding.bindingState || 'unknown'}</dd></div>
            <div><dt>所有权验证</dt><dd>{binding.verificationState || 'unknown'}</dd></div>
            <div><dt>提供方新鲜度</dt><dd>{binding.freshnessState || 'unknown'}</dd></div>
            <div><dt>作用域</dt><dd>{binding.scopeMatch || 'unknown'}</dd></div>
            <div><dt>绑定修订 ID</dt><dd><code>{binding.bindingId || '未记录'}</code></dd></div>
          </dl>
        )) : (
          <p>这条正式作品没有被授权的外部 IdentityBinding；系统保留 partial 状态，不制造外部身份。</p>
        )}
      </section>

      <section className="detail-card">
        <h2>新流程状态</h2>
        <dl>
          <div><dt>Research</dt><dd>{research.observation?.state || 'not_observed'}</dd></div>
          <div><dt>Assessment</dt><dd>{assessment.observation?.state || 'not_observed'}</dd></div>
          <div><dt>Fail closed</dt><dd>{effectiveState.ai?.selection?.failClosed ? '是' : '否'}</dd></div>
          <div><dt>当前评级</dt><dd>无；旧评级未导入</dd></div>
        </dl>
      </section>

      <section className="detail-card">
        <h2>完整性与来源</h2>
        <dl>
          <div><dt>文档 SHA-256</dt><dd><code>{result.documentSha256}</code></dd></div>
          <div><dt>迁移包</dt><dd><code>{provenance.summary?.packageId || '未记录'}</code></dd></div>
          <div><dt>AuditRun</dt><dd><code>{provenance.auditRunRef || '未记录'}</code></dd></div>
          <div><dt>旧运行时依赖</dt><dd>{provenance.summary?.legacyRuntimeDependency === false ? '无' : '未通过'}</dd></div>
        </dl>
      </section>
    </main>
  )
}
