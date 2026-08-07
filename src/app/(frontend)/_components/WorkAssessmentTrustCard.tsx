import Link from 'next/link'

import { buildRadarAssessmentPresentation, type RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'
import { radarGradeLabels, type RadarGrade } from '@/lib/radar/ratingPolicy'
import type { RadarAuthority } from '@/lib/radar/readStandardization'
import type { RadarConclusionMode, RadarPublicTagContract } from '@/lib/radar/conclusionNormalizer.mjs'

import type { DetailItem, RadarResearchPreview } from '../_lib/detail-index'
import StewardshipNoticeBlock from './StewardshipNoticeBlock'

type AssessmentItem = DetailItem & {
  radarAssessment?: RadarAssessmentMetrics
  radarAuthority?: RadarAuthority
  radarAuthorityPending?: boolean
  ratingNotice?: string
  reviewStatus?: string
  evidenceStrength?: string
  humanAssessment?: { grade?: string; status?: string; note?: string; sourceSummary?: string }
}
type Research = RadarResearchPreview & {
  conclusionMode?: RadarConclusionMode
  fixedGrade?: string
  evidenceCoveragePercent?: number
  unresolvedQuestions?: string[]
  requiresHumanReview?: boolean
  validationIssues?: string[]
  warningTemplateId?: string
  publicTags?: RadarPublicTagContract[]
}

const grades = new Set<RadarGrade>(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])
const riskLabels: Record<string, string> = {
  male_involvement: '男性介入', ntr: 'NTR', futa: '扶她', otokonoko: '男娘 / 伪娘',
  ts: 'TS / 性别转换', prior_male_relationship: '既往男性关系', abo: 'ABO', other: '其他风险',
}
const authorityLabels: Partial<Record<RadarAuthority, string>> = {
  published: '已发布 AI 评级',
  candidate: 'AI 候选结论（待发布）',
  research: '仅有研究资料',
  legacy: '旧兼容投影',
  unassessed: '尚未评估',
}

function normalizeGrade(value?: string | null): RadarGrade | '' {
  const grade = String(value || '').trim().toUpperCase()
  if (grade === 'AA') return 'S'
  return grades.has(grade as RadarGrade) ? grade as RadarGrade : ''
}

function sourceCount(item: DetailItem, recorded: number | null) {
  const urls = new Set([
    ...(item.sourceLinks || []).map((source) => source.url),
    ...(item.candidateSources || []).map((source) => source.url),
  ].filter(Boolean))
  return recorded === null && urls.size === 0 ? null : Math.max(recorded || 0, urls.size)
}

function hasSources(item: DetailItem) {
  return Boolean(
    (item.sourceLinks || []).some((source) => source.url)
    || (item.candidateSources || []).some((source) => source.url || source.externalId)
    || Object.values(item.externalIds || {}).some(Boolean),
  )
}

function Metric({ label, value, description }: { label: string; value: number | null; description: string }) {
  return <article className="work-assessment-metric" data-calculated={value !== null ? 'true' : 'false'}>
    <div className="work-assessment-metric-heading"><span>{label}</span><strong>{value === null ? '尚未计算' : `${value}%`}</strong></div>
    {value === null ? <div className="work-assessment-progress-placeholder" aria-hidden="true" /> : <progress max={100} value={value} />}
    <p>{description}</p>
  </article>
}

export default function WorkAssessmentTrustCard({ item }: { item: DetailItem }) {
  const stewardship = <StewardshipNoticeBlock item={item as DetailItem & { stewardshipNotices?: never[] }} />
  if (item.collection !== 'works') return stewardship

  const assessmentItem = item as AssessmentItem
  const research = item.researchPreview as Research | undefined
  const runtimeAuthority = assessmentItem.radarAuthority
  const exactMachineAuthority = runtimeAuthority === 'published' || runtimeAuthority === 'candidate'
  const controlledRadarAssessment = exactMachineAuthority
    ? assessmentItem.radarAssessment
    : runtimeAuthority === 'research'
      ? undefined
      : assessmentItem.radarAssessment?.assessedAt
        ? assessmentItem.radarAssessment
        : undefined
  // Research is evidence lineage only. It never supplies a public AI grade/range,
  // including when the exact database read layer is temporarily unavailable.
  const researchOnly = runtimeAuthority === 'research'
    || Boolean(research && !controlledRadarAssessment)
  const hasAI = Boolean(controlledRadarAssessment)
  const presentation = buildRadarAssessmentPresentation({
    radarAssessment: controlledRadarAssessment,
    ratingNotice: researchOnly
      ? 'insufficient_information'
      : assessmentItem.ratingNotice === 'manual_reviewed'
        ? 'manual_reviewed'
        : hasAI ? assessmentItem.ratingNotice || 'ai_synthesized_pending_review' : 'none',
    reviewStatus: assessmentItem.reviewStatus,
    evidenceStrength: assessmentItem.evidenceStrength,
  })

  const recordedGrade = normalizeGrade(item.rank)
  const humanStatus = assessmentItem.humanAssessment?.status
    || (assessmentItem.ratingNotice === 'manual_reviewed' || assessmentItem.reviewStatus === 'reviewed' ? 'reviewed' : 'pending')
  const explicitHumanGrade = humanStatus === 'pending' ? '' : normalizeGrade(assessmentItem.humanAssessment?.grade)
  const legacyHumanGrade = assessmentItem.ratingNotice === 'manual_reviewed' || assessmentItem.reviewStatus === 'reviewed' ? recordedGrade : ''
  const humanGrade = explicitHumanGrade || legacyHumanGrade
  const fixedAIGrade = normalizeGrade(presentation.fixedGrade)
  const publishedLikelyProjection = runtimeAuthority === 'published'
    ? normalizeGrade(presentation.likelyGrade)
    : ''
  const legacyManualAIPlaceholder = Boolean(
    !runtimeAuthority
    && assessmentItem.radarAssessment
    && !assessmentItem.radarAssessment.assessedAt
    && assessmentItem.ratingNotice === 'ai_synthesized_pending_review'
    && humanStatus === 'pending',
  )
  const fallbackRecordedGrade = !runtimeAuthority
    && !researchOnly
    && !legacyManualAIPlaceholder
    && presentation.conclusionMode === 'fixed_grade'
      ? recordedGrade
      : ''
  const publishedCatalogGrade = runtimeAuthority === 'published'
    ? fixedAIGrade || publishedLikelyProjection
    : ''
  const catalogGrade = humanGrade || publishedCatalogGrade || fallbackRecordedGrade
  const bounded = presentation.conclusionMode === 'bounded_range'
  const aiHeading = researchOnly
    ? '仅有研究资料'
    : bounded
      ? 'AI 暂定评级范围'
      : presentation.conclusionMode === 'fixed_grade'
        ? runtimeAuthority === 'published' ? '固定 AI 等级' : 'AI 暂定等级'
        : presentation.conclusionTitle
  const aiSummary = researchOnly
    ? '尚未形成公开 AI 评级'
    : bounded
      ? `${presentation.conclusionDisplay} · ${presentation.likelyLabel}`
      : fixedAIGrade ? `${fixedAIGrade} 级` : presentation.conclusionDisplay
  const acceleratedTag = presentation.publicTags.find((tag) => tag.key === 'accelerated-radar-ai-review')
  const unresolved = research?.unresolvedQuestions || presentation.unresolvedDimensions
  const risks = (research?.riskSignals || []).map((value) => riskLabels[value] || value)
  const sources = sourceCount(item, presentation.sourceCount)
  const authorityLabel = runtimeAuthority
    ? authorityLabels[runtimeAuthority] || runtimeAuthority
    : researchOnly
      ? '仅有研究资料（静态降级）'
      : '静态兼容展示'
  const catalogGradeDisplay = humanGrade
    ? `${humanGrade} 级`
    : runtimeAuthority === 'candidate'
      ? '待发布，不进入目录'
      : researchOnly
        ? '尚未形成公开评级'
        : publishedLikelyProjection && !fixedAIGrade
          ? `${publishedLikelyProjection} 级（范围兼容投影）`
          : catalogGrade
            ? `${catalogGrade} 级`
            : '尚未填入'

  return <>
    {stewardship}
    <section className="detail-card work-assessment-trust-card" data-grade={catalogGrade || 'unknown'} aria-label="人工参考意见与 AI 建议">
      <header className="work-assessment-rating">
        <div className="work-assessment-grade-mark">{humanGrade || '?'}</div>
        <div className="work-assessment-rating-copy">
          <p className="eyebrow">人工审核参考</p>
          <span className="work-assessment-grade-basis">{humanGrade ? '已记录人工意见' : '尚未记录人工意见'}</span>
          <h2>{humanGrade ? `${humanGrade} · ${radarGradeLabels[humanGrade]}` : '暂无人工参考等级'}</h2>
          <p>{humanGrade ? '人工轨道保持优先；AI 轨道独立保留，不覆盖人工结论。' : '人工轨道尚未完成；下方 AI 建议不构成人工最终结论。'}</p>
        </div>
      </header>

      <dl className="work-assessment-statuses work-assessment-statuses-primary">
        <div><dt>人工轨道状态</dt><dd>{humanStatus === 'reviewed' ? '已记录' : humanStatus === 'disputed' ? '有争议' : '未提交'}</dd></div>
        <div><dt>目录采用等级</dt><dd>{catalogGradeDisplay}</dd></div>
        <div><dt>Radar 数据层级</dt><dd>{authorityLabel}</dd></div>
        <div><dt>页面提示</dt><dd data-tone={presentation.pageNoticeTone}>{humanGrade ? '人工参考 + AI 双轨' : presentation.reviewLabel}</dd></div>
        <div><dt>证据强度</dt><dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd></div>
      </dl>

      {assessmentItem.humanAssessment?.note || assessmentItem.humanAssessment?.sourceSummary ? <section className="work-assessment-human-note">
        <span>人工轨道说明</span>
        {assessmentItem.humanAssessment.note ? <p>{assessmentItem.humanAssessment.note}</p> : null}
        {assessmentItem.humanAssessment.sourceSummary ? <p><strong>来源摘要：</strong>{assessmentItem.humanAssessment.sourceSummary}</p> : null}
      </section> : null}

      {legacyManualAIPlaceholder ? <p className="work-assessment-pending-grade-note">旧规则占位不再把它展示成 AI 结论；该作品等待 AI Radar 管线，并进入下一次未评估作品管线。</p> : null}

      <details className="work-assessment-ai-panel" open={!humanGrade}>
        <summary><span>AI 建议与规则分析</span><strong>{aiSummary || '等待 AI Radar 管线'}</strong><small>独立展示，不覆盖人工评级</small></summary>
        <div className="work-assessment-ai-body">
          <header className="work-assessment-ai-heading">
            <div className="work-assessment-ai-grade" data-grade={fixedAIGrade || presentation.likelyGrade || 'unknown'}>{researchOnly ? '?' : bounded ? presentation.conclusionDisplay : fixedAIGrade || '?'}</div>
            <div>
              <span>{aiHeading}</span>
              <h3>{aiSummary || '尚未形成可展示的等级建议'}</h3>
              <p>{researchOnly
                ? '当前只有与该作品身份绑定的研究资料；研究建议等级不会自动提升为 Candidate、Published 或固定 AI 等级。'
                : bounded
                  ? '资料尚不完整；最可能等级不是固定等级，也不是人工最终结论。'
                  : fixedAIGrade ? '该单等级来自当前规则或 AI 研究整理，仍可由人工证据修正，不等于不可改变的最终结论。'
                    : '当前只有规则、标签或研究状态线索，不能展示为固定等级。'}</p>
            </div>
          </header>

          {acceleratedTag ? <p className="work-assessment-pending-grade-note"><strong>{acceleratedTag.group} · {acceleratedTag.value}</strong>：资料覆盖、待查问题或人工复核条件仍未完成。</p> : null}
          <dl className="work-assessment-statuses">
            <div><dt>结论模式</dt><dd>{researchOnly ? 'research_only' : presentation.conclusionMode}</dd></div>
            <div><dt>需要人工复核</dt><dd>{researchOnly || presentation.requiresHumanReview ? '是' : '否'}</dd></div>
            <div><dt>AI 证据状态</dt><dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd></div>
            <div><dt>可追溯来源</dt><dd>{sources === null ? '尚未统计' : `${sources} 条`}</dd></div>
          </dl>

          {research ? <section className="work-assessment-research-preview" aria-label="AI 研究档案 · 资料摘要">
            <span>AI 研究档案 · 资料摘要</span>
            <h3>{research.recommendedNextAction || '等待进一步资料或人工复核'}</h3>
            <p>汇总资料覆盖、未解决问题、已知风险与来源；Research 提议等级只作为研究线索，不会在这里重复展示成第二个公开评级。</p>
            <dl>
              <div><dt>研究置信度</dt><dd>{typeof research.confidencePercent === 'number' ? `${Math.round(research.confidencePercent)}%` : '尚未计算'}</dd></div>
              <div><dt>资料覆盖度</dt><dd>{typeof research.evidenceCoveragePercent === 'number' ? `${Math.round(research.evidenceCoveragePercent)}%` : '尚未计算'}</dd></div>
              <div><dt>未解决问题</dt><dd>{unresolved.length || research.unresolvedQuestionCount || 0} 项</dd></div>
            </dl>
            {risks.length ? <p><strong>已知风险：</strong>{risks.join('、')}</p> : null}
            {unresolved.length ? <ul>{unresolved.map((value) => <li key={value}>{value}</li>)}</ul> : null}
            {research.sourceSummary ? <p><strong>来源摘要：</strong>{research.sourceSummary}</p> : null}
          </section> : null}

          {presentation.decisiveRuleCode ? <section className="work-assessment-decisive"><span>决定性规则 / 分类类别</span><h3>{presentation.decisiveRuleCode}</h3><p>{presentation.decisiveRuleReason || '分类类别不替代固定等级或有界范围。'}</p></section> : null}
          {presentation.matchedRules.length ? <section className="work-assessment-decisive"><span>全部命中规则</span><ul>{presentation.matchedRules.map((rule) => <li key={`${rule.code}-${rule.grade}`}>{rule.code}{rule.grade ? ` · ${rule.grade}` : ''}{rule.reason ? `：${rule.reason}` : ''}</li>)}</ul></section> : null}
          {presentation.validationIssues.length ? <section className="work-assessment-contradictions"><span>结论兼容提示</span><ul>{presentation.validationIssues.map((value) => <li key={value}>{value}</li>)}</ul></section> : null}

          <div className="work-assessment-metrics">
            <Metric label="判断置信度" value={presentation.confidence} description={presentation.confidenceExplanation} />
            <Metric label="资料覆盖度" value={presentation.coverage} description={presentation.coverageExplanation} />
          </div>
          {presentation.sourceSummary ? <p className="work-assessment-source-summary"><strong>AI 来源摘要：</strong>{presentation.sourceSummary}</p> : null}
          {!hasSources(item) ? <p className="work-assessment-source-warning">当前公开页面没有可追溯来源链接；建议先补充来源，再采纳任何自动建议。</p> : null}
        </div>
      </details>

      <div className="work-assessment-links">
        <Link href="/rules">查看完整分级细则</Link>
        <Link href={`/feedback?collection=works&title=${encodeURIComponent(item.title)}&workId=${encodeURIComponent(item.recordId || '')}`}>补充资料 / 提交纠错</Link>
      </div>
    </section>
  </>
}
