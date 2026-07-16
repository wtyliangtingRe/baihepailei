import Link from 'next/link'

import { radarClassDefinitions, radarGradeLabels, type RadarGrade, type RadarRatingClass } from '@/lib/radar/ratingPolicy'
import { buildRadarAssessmentPresentation, type RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import type { DetailItem } from '../_lib/detail-index'

type AssessmentDetailItem = DetailItem & {
  radarAssessment?: RadarAssessmentMetrics
  ratingNotice?: string
  reviewStatus?: string
  evidenceStrength?: string
}

const radarGrades = new Set<RadarGrade>(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

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

export default function WorkAssessmentTrustCard({ item }: { item: DetailItem }) {
  if (item.collection !== 'works') return null

  const assessmentItem = item as AssessmentDetailItem
  const presentation = buildRadarAssessmentPresentation({
    radarAssessment: assessmentItem.radarAssessment,
    ratingNotice: assessmentItem.ratingNotice,
    reviewStatus: assessmentItem.reviewStatus,
    evidenceStrength: assessmentItem.evidenceStrength,
  })
  const recordedGrade = normalizeGrade(item.rank)
  const suggestedGrade = normalizeGrade(presentation.suggestedGrade)
  const isHumanReviewed = assessmentItem.ratingNotice === 'manual_reviewed' || assessmentItem.reviewStatus === 'reviewed'
  const grade = isHumanReviewed ? recordedGrade || suggestedGrade : suggestedGrade || recordedGrade
  const gradeBasis = isHumanReviewed ? '人工确认分级' : suggestedGrade ? '规则建议等级' : recordedGrade ? '当前收录等级' : '尚未分级'
  const sourceCount = publicSourceCount(item, presentation.sourceCount)
  const decisiveDefinition = ruleDefinition(presentation.decisiveRuleCode)

  return (
    <section className="detail-card work-assessment-trust-card" data-grade={grade || 'unknown'} aria-label="作品排雷结论与依据">
      <header className="work-assessment-rating">
        <div className="work-assessment-grade-mark" aria-label={grade ? `${grade}级` : '尚未分级'}>{grade || '?'}</div>
        <div className="work-assessment-rating-copy">
          <p className="eyebrow">排雷结论</p>
          <span className="work-assessment-grade-basis">{gradeBasis}</span>
          <h2>{grade ? `${grade} · ${radarGradeLabels[grade]}` : '待定 · 信息尚不足'}</h2>
          <p>
            {presentation.requiresHumanReview
              ? '这是基于当前材料形成的页面判断，仍可随复核和新证据更新。'
              : '当前判断已有复核记录；如发现遗漏，仍可提交来源与纠错说明。'}
          </p>
        </div>
      </header>

      <dl className="work-assessment-statuses work-assessment-statuses-primary">
        <div>
          <dt>页面提示</dt>
          <dd data-tone={presentation.pageNoticeTone}>{presentation.reviewLabel}</dd>
        </div>
        <div>
          <dt>证据状态</dt>
          <dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd>
        </div>
        <div>
          <dt>复核状态</dt>
          <dd>{presentation.reviewStatusLabel}</dd>
        </div>
        <div>
          <dt>可追溯来源</dt>
          <dd>{sourceCount === null ? '尚未统计' : `${sourceCount} 条`}</dd>
        </div>
        {presentation.assessedAt ? (
          <div>
            <dt>评估日期</dt>
            <dd>{presentation.assessedAt}</dd>
          </div>
        ) : null}
        {presentation.policyVersion ? (
          <div>
            <dt>规则版本</dt>
            <dd>{presentation.policyVersion}</dd>
          </div>
        ) : null}
      </dl>

      {presentation.sourceSummary ? (
        <div className="work-assessment-source-summary">
          <span>来源摘要</span>
          <p>{presentation.sourceSummary}</p>
        </div>
      ) : (
        <p className="work-assessment-empty-note">本条目可以先收录；当前来源摘要尚未补齐，评级详情会保持待复核或信息不足提示。</p>
      )}

      {presentation.decisiveRuleCode ? (
        <section className="work-assessment-decisive" data-grade={normalizeGrade(decisiveDefinition?.grade) || grade || 'unknown'}>
          <span>决定性规则</span>
          <h3>{presentation.decisiveRuleCode}{decisiveDefinition ? ` · ${decisiveDefinition.label}` : ''}</h3>
          <p>{presentation.decisiveRuleReason || '当前没有额外规则说明，请结合命中规则、雷点矩阵和公开来源阅读。'}</p>
        </section>
      ) : null}

      <section className="work-assessment-rules" aria-label="命中规则">
        <div className="work-assessment-section-heading">
          <div>
            <span>评级细则</span>
            <h3>全部命中规则</h3>
          </div>
          <strong>{presentation.matchedRules.length} 条</strong>
        </div>
        {presentation.matchedRules.length ? (
          <div className="work-assessment-rule-list">
            {presentation.matchedRules.map((rule, index) => {
              const definition = ruleDefinition(rule.code)
              const ruleGrade = normalizeGrade(rule.grade) || normalizeGrade(definition?.grade)
              return (
                <article className="work-assessment-rule" data-decisive={rule.code === presentation.decisiveRuleCode ? 'true' : 'false'} data-grade={ruleGrade || 'unknown'} key={`${rule.code}-${index}`}>
                  <div className="work-assessment-rule-head">
                    <span>{ruleGrade ? `${ruleGrade}级` : '待定'}</span>
                    {rule.confidencePercent !== null ? <small>置信度 {rule.confidencePercent}%</small> : null}
                  </div>
                  <strong>{rule.code || '未记录规则代码'}</strong>
                  <h4>{definition?.label || '规则说明待补充'}</h4>
                  {rule.reason ? <p>{rule.reason}</p> : null}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="work-assessment-empty-note">尚未写入规则命中明细。未知作品仍可保留在资料库中，待材料补齐后再形成排雷建议。</p>
        )}
      </section>

      {presentation.contradictions.length ? (
        <aside className="work-assessment-contradictions" aria-label="证据冲突">
          <strong>当前存在证据冲突</strong>
          <ul>{presentation.contradictions.map((item) => <li key={item}>{item}</li>)}</ul>
        </aside>
      ) : null}

      {presentation.hasCalculatedMetrics ? (
        <div className="work-assessment-metrics">
          <Metric description={presentation.confidenceExplanation} label="判断置信度" value={presentation.confidence} />
          <Metric description={presentation.coverageExplanation} label="资料覆盖度" value={presentation.coverage} />
        </div>
      ) : null}

      <nav className="work-assessment-actions" aria-label="评级相关操作">
        <Link href="/rules">查看完整分级细则</Link>
        {hasPublicSources(item) ? <a href="#public-sources">查看公开来源</a> : null}
        <Link href="/feedback">补充资料 / 提交纠错</Link>
      </nav>

      <p className="work-assessment-disclaimer">
        页面将等级、来源、证据状态与页面提示分别展示。置信度表示当前判断与材料的一致程度，不等同于作品安全概率。
      </p>
    </section>
  )
}
