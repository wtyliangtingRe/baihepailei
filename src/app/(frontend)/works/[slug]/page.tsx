import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  getPublicReleaseManifest,
  getPublicWorkById,
  type PublicRatingState,
  type PublicWorkRecord,
} from '@/lib/publicRelease'

import { recordIdFromContentRoute } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

const statusLabels: Record<PublicRatingState, string> = {
  rated: '已有评级',
  research_record_only: '仅资料记录',
  conflict: '评级冲突',
  blocked: '身份 / 数据阻断',
  research_required: '待专项研究',
  not_assessed: '尚未评估',
}

const statusDescriptions: Record<PublicRatingState, string> = {
  rated: '已有当前可发布的 S–F 结论。',
  research_record_only: '找到研究或资料记录，但没有可发布的 Assessment；本版不强行评级。',
  conflict: '现有评级权威互相冲突；冲突被保留，等待后续版本裁决。',
  blocked: '身份或数据包边界仍阻断评级权威；本版只公布阻断状态。',
  research_required: '现有材料不足以完成专项判断，已明确进入待研究队列。',
  not_assessed: '作品身份已进入公开目录，但不属于本轮 4,115 个完整审计作品。',
}

const sourceLabels: Record<string, string> = {
  frozen_assessment: '冻结 Assessment 的唯一精确等级',
  unanimous_authority_normalization_v12: '多来源一致等级归一化',
  global_v18_successor_rating: '保守证据不足评级',
  global_v20_successor_rating: '有限证据保守评级',
  global_v23_successor_rating: '小尾部语义评估',
  authored_assessment_authority_v24: '作者结论权威归一化',
  authored_bounded_range_v26: '作者结论范围保留',
  authority_locator_v27: '全引用 Assessment 定位审计',
  final_tail_profile_v29: '最终小尾部状态审计',
  owner_v06_calibration_pr533: '最新 owner v0.6 校准',
  owner_railgun_successor_pr533: '最新 Railgun owner successor 校准',
}

function identityLabel(state: PublicWorkRecord['identity']['state']): string {
  if (state === 'exact') return '精确外部身份'
  if (state === 'repair_required') return '外部身份待修复'
  return '部分身份'
}

function confidenceLabel(value?: string): string {
  if (value === 'low') return '低'
  if (value === 'medium') return '中'
  if (value === 'high' || value === 'established' || value === 'authored') return '已建立'
  return '未单列'
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const workId = recordIdFromContentRoute('works', slug)
  const work = workId ? getPublicWorkById(workId) : null
  return work ? { title: work.title, description: `Work ${work.workId} 的当前百合排雷评级与数据状态。` } : {}
}

export default async function WorkDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workId = recordIdFromContentRoute('works', slug)
  if (!workId) notFound()
  const work = getPublicWorkById(workId)
  if (!work) notFound()
  const manifest = getPublicReleaseManifest()
  const rating = work.rating
  const hasRange = Boolean(
    rating.bestGrade && rating.worstGrade && rating.bestGrade !== rating.worstGrade,
  )

  return (
    <main className="page collection-page release-detail-page">
      <section className="release-detail-hero">
        <div className="release-detail-grade">
          {rating.grade ? (
            <span className={`rating-chip rating-chip-large grade-${rating.grade}`}>{rating.grade}</span>
          ) : (
            <span className={`status-symbol status-symbol-large status-${rating.state}`}>—</span>
          )}
        </div>
        <div>
          <p className="eyebrow">Work {work.workId} · {statusLabels[rating.state]}</p>
          <h1>{work.title}</h1>
          <p>{statusDescriptions[rating.state]}</p>
          <div className="work-card-badges">
            <span className="work-type-chip">{identityLabel(work.identity.state)}</span>
            <span className="work-type-chip">{work.audited ? '本轮完整审计' : '公开目录记录'}</span>
            {rating.needsMoreResearch ? <span className="work-type-chip warning-chip">仍需补证</span> : null}
          </div>
          <div className="collection-actions">
            <Link className="back-link" href="/works">返回作品列表</Link>
            {rating.grade ? <Link className="back-link" href={`/works?grade=${rating.grade}`}>查看同级作品</Link> : null}
          </div>
        </div>
      </section>

      <div className="release-detail-grid">
        <section className="detail-card">
          <p className="eyebrow">当前结论</p>
          <h2>{rating.grade ? `${rating.grade} 级` : statusLabels[rating.state]}</h2>
          <dl className="release-detail-list">
            <div><dt>发布状态</dt><dd>{statusLabels[rating.state]}</dd></div>
            {rating.grade ? <div><dt>核心等级</dt><dd>{rating.grade}</dd></div> : null}
            {hasRange ? <div><dt>保留范围</dt><dd>{rating.bestGrade} – {rating.worstGrade}（最可能 {rating.likelyGrade}）</dd></div> : null}
            {rating.class ? <div><dt>来源分类</dt><dd>{rating.class === 'D-UNCLEAR' ? 'D（证据不足型）' : rating.class}</dd></div> : null}
            {rating.grade ? <div><dt>置信状态</dt><dd>{confidenceLabel(rating.confidence)}</dd></div> : null}
            <div><dt>是否仍需补证</dt><dd>{rating.needsMoreResearch ? '是' : '否'}</dd></div>
            {rating.source ? <div><dt>决策来源</dt><dd>{sourceLabels[rating.source] || rating.source}</dd></div> : null}
          </dl>
          {rating.reasoningSummary ? (
            <div className="release-reasoning">
              <strong>结论摘要</strong>
              <p>{rating.reasoningSummary}</p>
            </div>
          ) : null}
          {rating.class === 'D-UNCLEAR' ? (
            <p className="release-caution">
              这里的 D 只表示当前资料没有建立足够明确的百合 / 女性关系拓扑；
              它不推断男性结局、NTR 或其他具体雷点。
            </p>
          ) : null}
        </section>

        <section className="detail-card">
          <p className="eyebrow">身份与目录</p>
          <h2>公开身份</h2>
          <dl className="release-detail-list">
            <div><dt>Work ID</dt><dd><code>{work.workId}</code></dd></div>
            <div><dt>目录序号</dt><dd>{work.ordinal.toLocaleString('zh-CN')}</dd></div>
            <div><dt>身份状态</dt><dd>{identityLabel(work.identity.state)}</dd></div>
            <div><dt>外部提供方</dt><dd>{work.identity.provider}</dd></div>
            <div><dt>外部站点 ID</dt><dd><code>{work.identity.siteId}</code></dd></div>
            <div><dt>研究覆盖</dt><dd>{work.identity.coverage}</dd></div>
          </dl>
          {work.identity.state !== 'exact' ? (
            <p className="release-caution">身份边界会原样公开；站点不会用标题模糊匹配制造一个“看起来精确”的外部身份。</p>
          ) : null}
        </section>
      </div>

      <section className="release-snapshot-note">
        <div>
          <p className="eyebrow">可追溯快照</p>
          <h2>{manifest.releaseId}</h2>
        </div>
        <p>
          此页读取同一份冻结首发快照。后续发现只会通过新版本追加；
          当前版本的 Work ID、等级与非评级终态不会被静默改写。
        </p>
      </section>
    </main>
  )
}
