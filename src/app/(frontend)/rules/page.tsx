import Link from 'next/link'

import {
  RADAR_RATING_POLICY_ID,
  radarClassDefinitions,
  radarGradeLabels,
  radarPolicySafety,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'
import { warningTemplates } from '@/lib/radar/warningTemplates'

const gradeOrder: RadarGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

const safetyLabels: Record<keyof typeof radarPolicySafety, string> = {
  doNotOverwriteHumanVerified: '不覆盖人工已确认结论',
  doNotPublishAutoSuggestedFOrX: '自动建议的 F / X 不直接公开为最终评级',
  doNotAutoAssignX: '不自动分配 X 黑名单等级',
  preserveConflictingEvidence: '保留冲突证据与来源差异',
  storePolicyVersion: '记录规则版本',
  autoSuggestionsAreNotFinalPublicRatings: '自动建议不是最终公开评级',
}

const classEntries = Object.entries(radarClassDefinitions) as Array<[
  RadarRatingClass,
  (typeof radarClassDefinitions)[RadarRatingClass],
]>

function classesForGrade(grade: RadarGrade) {
  return classEntries.filter(([, definition]) => definition.grade === grade)
}

function policyBadges(code: RadarRatingClass, definition: (typeof radarClassDefinitions)[RadarRatingClass]) {
  return [
    code,
    definition.requiresHumanReview ? '需人工复核' : '',
    definition.doNotAutoPublish ? '不自动公开' : '',
  ].filter(Boolean)
}

export default function RulesIndexPage() {
  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">排雷规则</p>
        <h1>排雷规则</h1>
        <p>
          恢复完整排雷分级细则、警示模板与安全原则。资料库可以先收录未知作品，排雷结论必须标明来源、证据状态与复核状态。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=rules">搜索旧规则条目</Link>
          <Link className="back-link" href="/terms">名词解释</Link>
          <span>{RADAR_RATING_POLICY_ID}</span>
          <span>{classEntries.length} 条细则</span>
          <span>{warningTemplates.length} 个警示模板</span>
        </div>
      </section>

      <section className="rank-explainer">
        <div>
          <h2>守夜人原则</h2>
          <p>
            排雷不是把作品从资料库里删除，而是在公开资料库中尽可能保留来源、争议、未知状态与证据链。AI 综合、外部来源与人工结论需要明确区分。
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
                    <span>{policyBadges(code, definition).join(' / ')}</span>
                    <span>关键词：{definition.keywords.join('、')}</span>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </section>

      <section className="rank-explainer">
        <div>
          <h2>页面警示模板</h2>
          <p>
            警示模板用于在作品、证据或资料页提示信息状态。它们和排雷等级相关，但不等同于最终评级。
          </p>
        </div>
        <div className="collection-grid collection-grid-compact">
          {warningTemplates.map((template) => (
            <article className="collection-card collection-card-compact" key={template.id}>
              <p>{template.style} / {template.severity}</p>
              <h2>{template.title}</h2>
              <span>{template.text}</span>
              {template.relatedRatingClasses?.length ? (
                <span>关联细则：{template.relatedRatingClasses.join('、')}</span>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
