import Link from 'next/link'

import {
  RADAR_RATING_POLICY_ID,
  radarClassDefinitions,
  radarGradeLabels,
  radarPolicySafety,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'

const gradeOrder: RadarGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

const safetyLabels: Record<keyof typeof radarPolicySafety, string> = {
  doNotOverwriteHumanVerified: '不覆盖人工已确认结论',
  severeRatingsRemainPublic: '重雷、高危与黑名单等级保持公开展示',
  doNotAutoAssignX: '不自动分配 X 黑名单等级',
  preserveConflictingEvidence: '保留冲突证据与来源差异',
  storePolicyVersion: '记录规则版本',
  autoSuggestionsAreNotFinalPublicRatings: '自动建议不是最终公开评级',
  reviewNoticeUsesPageTemplates: '复核状态使用页面提示模板展示',
}

const classEntries = Object.entries(radarClassDefinitions) as Array<[
  RadarRatingClass,
  (typeof radarClassDefinitions)[RadarRatingClass],
]>

function classesForGrade(grade: RadarGrade) {
  return classEntries.filter(([, definition]) => definition.grade === grade)
}

function policyBadges(code: RadarRatingClass) {
  return [code]
}

export default function RulesIndexPage() {
  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">排雷规则</p>
        <h1>排雷规则</h1>
        <p>
          展示完整排雷分级细则与公开原则。资料库可以先收录未知作品，排雷结论必须标明来源、证据状态与页面提示状态。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=rules">搜索旧规则条目</Link>
          <Link className="back-link" href="/terms">页面提示</Link>
          <span>{RADAR_RATING_POLICY_ID}</span>
          <span>{classEntries.length} 条细则</span>
        </div>
      </section>

      <section className="rank-explainer">
        <div>
          <h2>守夜人原则</h2>
          <p>
            排雷不是把作品从资料库里删除，而是在公开资料库中尽可能保留来源、争议、未知状态与证据链。AI 综合、外部来源与人工结论需要明确区分；F 级与 X 级也应公开展示，真正需要隐藏的只有非法、侵权或不适合公开的材料本身。
          </p>
        </div>
        <div className="rank-explainer-grid">
          {Object.entries(safetyLabels).map(([key, label]) => (
            <div className="rank-explainer-card" key={key}>
              <h3>{label}</h3>
              <p>{radarPolicySafety[key as keyof typeof radarPolicySafety] ? '启用' : '未启用'}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ranked-collection-list">
        {gradeOrder.map((grade) => {
          const gradeClasses = classesForGrade(grade)
          return (
            <section className="rank-group" id={`grade-${grade}`} key={grade}>
              <div className="rank-group-heading">
                <h2>{grade}：{radarGradeLabels[grade]}</h2>
                <span>{gradeClasses.length} 条</span>
              </div>
              <div className="collection-grid collection-grid-compact">
                {gradeClasses.map(([code, definition]) => (
                  <article className="collection-card collection-card-compact" key={code}>
                    <p>{definition.grade} 级</p>
                    <h2>{definition.label}</h2>
                    <span>{policyBadges(code).join(' / ')}</span>
                    <span>关键词：{definition.keywords.join('、')}</span>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </section>
    </main>
  )
}
