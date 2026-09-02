import Link from 'next/link'

import {
  radarClassDefinitions,
  radarGradeLabels,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'
import { getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

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
  const manifest = getPublicReleaseManifest()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">排雷规则</p>
        <h1>排雷规则</h1>
        <p>
          展示完整排雷分级细则。资料库可以先收录未知作品，排雷结论必须标明来源、证据状态与页面提示状态。
          首发快照只发布 S–F，没有自动生成 X。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/terms">返回站点说明</Link>
        </div>
      </section>

      <section className="release-method-note">
        <div>
          <p className="eyebrow">首发闭环规则</p>
          <h2>不确定性不藏在等级后面。</h2>
        </div>
        <p>
          {manifest.counts.dUnclearRatings.toLocaleString('zh-CN')} 条内部来源分类为 D-UNCLEAR 的记录，
          对外显示为“D（证据不足型）+ 低置信 + 仍需补证”。这是本次快照的证据状态标记，
          不是对具体雷点的推断。没有 Assessment、存在冲突或仍受阻断的 117 条则完全不赋等级。
        </p>
        <Link className="result-link" href="/ratings">查看实际分布</Link>
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
