import Link from 'next/link'

import {
  radarClassDefinitions,
  radarGradeLabels,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'

const gradeOrder: RadarGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

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
          展示完整排雷分级细则。资料库可以先收录未知作品，排雷结论必须标明来源、证据状态与页面提示状态。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/terms">站点说明</Link>
          <Link className="back-link" href="/search?collection=rules">搜索旧规则条目</Link>
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
