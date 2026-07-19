import Link from 'next/link'

import { radarClassDefinitions, radarGradeLabels, type RadarGrade, type RadarRatingClass } from '@/lib/radar/ratingPolicy'
import { buildRadarAssessmentPresentation, type RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import type { DetailItem, RadarResearchPreview } from '../_lib/detail-index'
import StewardshipNoticeBlock from './StewardshipNoticeBlock'

type AssessmentDetailItem = DetailItem & {
  radarAssessment?: RadarAssessmentMetrics
  ratingNotice?: string
  reviewStatus?: string
  evidenceStrength?: string
  humanAssessment?: {
    grade?: string
    status?: string
    note?: string
    sourceSummary?: string
    evidenceStatus?: string
    sourceLinks?: Array<{ label?: string; url?: string }>
    assessedAt?: string
  }
}

const radarGrades = new Set<RadarGrade>(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])
const researchStatusLabels: Record<string, string> = { resolved: '已解决', partial: '部分解决', insufficient: '信息不足', identity_problem: '身份问题' }
const riskSignalLabels: Record<string, string> = { male_involvement: '男性介入', ntr: 'NTR', futa: '扶她', otokonoko: '男娘 / 伪娘', ts: 'TS / 性别转换', prior_male_relationship: '既往男性关系', abo: 'ABO', other: '其他风险' }

function normalizeGrade(value?: string | null): RadarGrade | '' {
  const grade = String(value || '').trim().toUpperCase()
  if (grade === 'AA') return 'S'
  return radarGrades.has(grade as RadarGrade) ? grade as RadarGrade : ''
}

function ruleDefinition(code?: string) {
  const normalized = String(code || '').trim()
  if (!normalized || !(normalized in radarClassDefinitions)) return null
  return radarClassDefinitions[normalized as RadarRatingClass]
}

function publicSourceCount(item: DetailItem, recordedCount: number | null) {
  const urls = new Set([
    ...(item.sourceLinks || []).map((source) => source.url),
    ...(item.candidateSources || []).map((source) => source.url),
  ].filter(Boolean))
  if (recordedCount === null && urls.size === 0) return null
  return Math.max(recordedCount || 0, urls.size)
}

function hasPublicSources(item: DetailItem) {
  return Boolean(
    (item.sourceLinks || []).some((source) => source.url)
    || (item.candidateSources || []).some((source) => source.url || source.externalId)
    || Object.values(item.externalIds || {}).some(Boolean),
  )
}

function Metric({ description, label, value }: { description: string; label: string; value: number | null }) {
  return (
    <article className="work-assessment-metric" data-calculated={value !== null ? 'true' : 'false'}>
      <div className="work-assessment-metric-heading">
        <span>{label}</span>
        <strong>{value === null ? '尚未计算' : `${value}%`}</strong>
      </div>
      {value !== null ? <progress aria-label={`${label} ${value}%`} max={100} value={value} /> : <div className="work-assessment-progress-placeholder" aria-hidden="true" />}
      <p>{description}</p>
    </article>
  )
}

function ResearchPreview({ research }: { research: RadarResearchPreview }) {
  const risks = (research.riskSignals || []).map((value) => riskSignalLabels[value] || value)
  return (
    <section className="work-assessment-research-preview" aria-label="AI 研究档案预览">
      <div>
        <span>AI 研究档案 · 非正式评级</span>
        <h3>{research.likelyGrade && research.likelyGrade !== 'UNKNOWN' ? `最可能 ${research.likelyGrade} 级` : '等级仍待确认'}</h3>
        <p>这部分来自研究归档中的关联记录，用于辅助人工复核；它不会覆盖 Works 的人工正式分级。</p>
      </div>
      <dl>
        <div><dt>研究状态</dt><dd>{researchStatusLabels[research.researchStatus || ''] || research.researchStatus || '未知'}</dd></div>
        <div><dt>等级范围</dt><dd>{research.bestGrade && research.bestGrade !== 'UNKNOWN' ? research.bestGrade : '?'} ～ {research.worstGrade && research.worstGrade !== 'UNKNOWN' ? research.worstGrade : '?'}</dd></div>
        <div><dt>研究置信度</dt><dd>{typeof research.confidencePercent === 'number' ? `${Math.round(research.confidencePercent)}%` : '尚未计算'}</dd></div>
        <div><dt>未解决问题</dt><dd>{typeof research.unresolvedQuestionCount === 'number' ? `${research.unresolvedQuestionCount} 项` : '尚未统计'}</dd></div>
      </dl>
      {risks.length ? <p><strong>风险信号：</strong>{risks.join('、')}</p> : null}
    </section>
  )
}

export default function WorkAssessmentTrustCard({ item }: { item: DetailItem }) {
  const stewardship = <StewardshipNoticeBlock item={item as DetailItem & { stewardshipNotices?: never[] }} />
  if (item.collection !== 'works') return stewardship

  const assessmentItem = item as AssessmentDetailItem
  const research = item.researchPreview
  const researchAssessment: RadarAssessmentMetrics | undefined = research ? {
    confidencePercent: research.confidencePercent,
    sourceSummary: research.sourceSummary,
    sourceCount: research.sourceCount,
    suggestedGrade: research.likelyGrade,
    requiresHumanReview: true,
  } : undefined
  const presentation = buildRadarAssessmentPresentation({
    radarAssessment: assessmentItem.radarAssessment || researchAssessment,
    ratingNotice: assessmentItem.ratingNotice || (research ? 'ai_synthesized_pending_review' : undefined),
    reviewStatus: assessmentItem.reviewStatus,
    evidenceStrength: assessmentItem.evidenceStrength,
  })
  const recordedGrade = normalizeGrade(item.rank)
  const suggestedGrade = normalizeGrade(presentation.suggestedGrade)
  const explicitHumanGrade = normalizeGrade(assessmentItem.humanAssessment?.grade)
  const isLegacyHumanReviewed = assessmentItem.ratingNotice === 'manual_reviewed' || assessmentItem.reviewStatus === 'reviewed'
  const humanGrade = explicitHumanGrade || (isLegacyHumanReviewed ? recordedGrade : '')
  const humanStatus = assessmentItem.humanAssessment?.status || (isLegacyHumanReviewed ? 'reviewed' : 'pending')
  const aiGrade = suggestedGrade
  const catalogGrade = humanGrade || aiGrade || recordedGrade
  const pendingRecordedGrade = !humanGrade && recordedGrade ? recordedGrade : ''
  const sourceCount = publicSourceCount(item, presentation.sourceCount)
  const decisiveDefinition = ruleDefinition(presentation.decisiveRuleCode)
  const hasAIAnalysis = Boolean(
    assessmentItem.radarAssessment
    || research
    || aiGrade
    || presentation.sourceSummary
    || presentation.decisiveRuleCode
    || presentation.matchedRules.length
    || presentation.contradictions.length
    || presentation.hasCalculatedMetrics,
  )

  return (
    <>
      {stewardship}
      <section className="detail-card work-assessment-trust-card" data-grade={catalogGrade || 'unknown'} aria-label="人工参考意见与 AI 建议">
        <header className="work-assessment-rating">
          <div className="work-assessment-grade-mark" aria-label={humanGrade ? `人工参考等级 ${humanGrade}级` : '人工参考等级待记录'}>{humanGrade || '?'}</div>
          <div className="work-assessment-rating-copy">
            <p className="eyebrow">人工审核参考</p>
            <span className="work-assessment-grade-basis">{humanStatus === 'reviewed' && humanGrade ? '已记录人工意见' : '尚未记录人工意见'}</span>
            <h2>{humanGrade ? `${humanGrade} · ${radarGradeLabels[humanGrade]}` : '暂无人工参考等级'}</h2>
            <p>{humanGrade ? '这是可追溯的人工参考意见，不等于不可改变的最终结论。AI 轨道仍独立保留。' : '人工轨道尚未记录等级；AI 建议会在下方独立展示，并且不会冒充人工意见。'}</p>
          </div>
        </header>

        <dl className="work-assessment-statuses work-assessment-statuses-primary">
          <div><dt>人工轨道状态</dt><dd>{humanStatus === 'reviewed' ? '已记录' : humanStatus === 'disputed' ? '有争议' : '未提交'}</dd></div>
          <div><dt>目录采用等级</dt><dd>{catalogGrade ? `${catalogGrade} 级` : '尚未填写'}</dd></div>
          <div><dt>页面提示</dt><dd data-tone={presentation.pageNoticeTone}>{humanGrade ? '人工参考 + AI 双轨' : presentation.reviewLabel}</dd></div>
          <div><dt>证据强度</dt><dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd></div>
        </dl>

        {pendingRecordedGrade ? (
          <p className="work-assessment-pending-grade-note">数据库当前 rank 字段为 <strong>{pendingRecordedGrade} 级</strong>，且人工轨道尚未记录等级，因此这里不会把它显示成人工正式评级。</p>
        ) : null}

        <details className="work-assessment-ai-panel" open={!humanGrade}>
          <summary>
            <span>AI 建议与规则分析</span>
            <strong>{aiGrade ? `${aiGrade} 级建议` : '尚无明确建议'}</strong>
            <small>独立展示，不覆盖人工评级</small>
          </summary>
          <div className="work-assessment-ai-body">
            <header className="work-assessment-ai-heading">
              <div className="work-assessment-ai-grade" data-grade={aiGrade || 'unknown'}>{aiGrade || '?'}</div>
              <div>
                <span>AI / 规则建议等级</span>
                <h3>{aiGrade ? `${aiGrade} · ${radarGradeLabels[aiGrade]}` : '尚未形成可展示的等级建议'}</h3>
                <p>该等级来自规则解析、来源整理或 AI 研究档案，仅用于辅助人工复核。</p>
              </div>
            </header>

            <dl className="work-assessment-statuses">
              <div><dt>仍需人工复核</dt><dd>{presentation.requiresHumanReview ? '是' : '否'}</dd></div>
              <div><dt>AI 证据状态</dt><dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd></div>
              <div><dt>可追溯来源</dt><dd>{sourceCount === null ? '尚未统计' : `${sourceCount} 条`}</dd></div>
              {presentation.assessedAt ? <div><dt>AI 评估日期</dt><dd>{presentation.assessedAt}</dd></div> : null}
              {presentation.policyVersion ? <div><dt>规则版本</dt><dd>{presentation.policyVersion}</dd></div> : null}
            </dl>

            {presentation.sourceSummary ? (
              <div className="work-assessment-source-summary"><span>评级来源摘要（不是作品简介）</span><p>{presentation.sourceSummary}</p></div>
            ) : <p className="work-assessment-empty-note">AI / 规则评级的来源摘要尚未补齐。作品简介会在页面下方独立显示，不会拿来代替评级依据。</p>}

            {research ? <ResearchPreview research={research} /> : null}

            {presentation.decisiveRuleCode ? (
              <section className="work-assessment-decisive" data-grade={normalizeGrade(decisiveDefinition?.grade) || aiGrade || 'unknown'}>
                <span>决定性规则</span>
                <h3>{presentation.decisiveRuleCode}{decisiveDefinition ? ` · ${decisiveDefinition.label}` : ''}</h3>
                <p>{presentation.decisiveRuleReason || '当前没有额外规则说明，请结合命中规则和公开来源阅读。'}</p>
              </section>
            ) : null}

            <section className="work-assessment-rules" aria-label="AI 命中规则">
              <div className="work-assessment-section-heading">
                <div><span>AI / 规则评级细则</span><h3>全部命中规则</h3></div>
                <strong>{presentation.matchedRules.length} 条</strong>
              </div>
              {presentation.matchedRules.length ? (
                <div className="work-assessment-rule-list">
                  {presentation.matchedRules.map((rule, index) => {
                    const definition = ruleDefinition(rule.code)
                    const ruleGrade = normalizeGrade(rule.grade) || normalizeGrade(definition?.grade)
                    return (
                      <article className="work-assessment-rule" data-decisive={rule.code === presentation.decisiveRuleCode ? 'true' : 'false'} data-grade={ruleGrade || 'unknown'} key={`${rule.code}-${index}`}>
                        <div className="work-assessment-rule-head"><span>{ruleGrade ? `${ruleGrade}级` : '待定'}</span>{rule.confidencePercent !== null ? <small>置信度 {rule.confidencePercent}%</small> : null}</div>
                        <strong>{rule.code || '未记录规则代码'}</strong>
                        <h4>{definition?.label || '规则说明待补充'}</h4>
                        {rule.reason ? <p>{rule.reason}</p> : null}
                      </article>
                    )
                  })}
                </div>
              ) : <p className="work-assessment-empty-note">尚未写入规则命中明细。未知作品仍可保留在资料库中，待材料补齐后再形成 AI 建议。</p>}
            </section>

            {presentation.contradictions.length ? (
              <aside className="work-assessment-contradictions" aria-label="AI 证据冲突"><strong>当前存在证据冲突</strong><ul>{presentation.contradictions.map((value) => <li key={value}>{value}</li>)}</ul></aside>
            ) : null}

            {presentation.hasCalculatedMetrics ? (
              <div className="work-assessment-metrics">
                <Metric description={presentation.confidenceExplanation} label="AI 判断置信度" value={presentation.confidence} />
                <Metric description={presentation.coverageExplanation} label="AI 资料覆盖度" value={presentation.coverage} />
              </div>
            ) : null}

            {!hasAIAnalysis ? <p className="work-assessment-empty-note">当前没有 AI 建议或规则分析记录。</p> : null}
          </div>
        </details>

        <nav className="work-assessment-actions" aria-label="评级相关操作">
          <Link href="/rules">查看完整分级细则</Link>
          {hasPublicSources(item) ? <a href="#public-sources">查看公开来源</a> : null}
          <Link href="/feedback">补充资料 / 提交纠错</Link>
        </nav>

        <p className="work-assessment-disclaimer">人工审核参考与 AI 建议分开显示。AI 置信度表示建议与当前材料的一致程度，不等同于作品安全概率，也不会自动覆盖人工结论。</p>
      </section>
    </>
  )
}
