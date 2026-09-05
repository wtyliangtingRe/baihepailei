import Link from 'next/link'

import {
  radarClassEntries,
  radarGradeLabels,
  radarGradeSummaries,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'
import { getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

const gradeOrder: RadarGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

function classesForGrade(grade: RadarGrade) {
  return radarClassEntries.filter(([, definition]) => definition.grade === grade)
}

function classBadges(code: RadarRatingClass, definition: (typeof radarClassEntries)[number][1]) {
  const badges: string[] = []
  if (definition.tags.includes('setting_profile')) badges.push('设定警示')
  if (definition.tags.includes('minimum_grade_interceptor')) badges.push('最低等级拦截')
  if (definition.requiresHumanReview) badges.push('仅人工裁决')
  if (code === 'F-MALE-ROMANTIC-AXIS') badges.push('现行增补')
  return badges
}

export default function RulesIndexPage() {
  const manifest = getPublicReleaseManifest()

  return (
    <main className="page collection-page release-rules-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">现行排雷规则 · v0.6 + 当前增补</p>
        <h1>50 条细则，完整公开。</h1>
        <p>
          规则先描述可核验的关系、结局、设定与项目事实，再绑定到 S–X 等级。
          作品页展示的是当前已有结论；本页说明每个标签究竟需要什么证据、又不能拿什么来误判。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/ratings">先看等级阅读指南</Link>
          <Link className="back-link" href="/works?status=rated">浏览实际评级</Link>
        </div>
      </section>

      <section className="release-reading-model release-rules-model">
        <article>
          <span>事实优先</span>
          <h2>不能从类型印象反推剧情</h2>
          <p>标题、目录标签、社区 ship 或“没查到问题”都不能单独建立关系与雷点。</p>
        </article>
        <article>
          <span>低级拦截</span>
          <h2>严重事实不会被高分遮住</h2>
          <p>命中更低等级事实时，最终核心等级必须下降；同级多个标签可以同时保留。</p>
        </article>
        <article>
          <span>范围公开</span>
          <h2>未知不等于安全</h2>
          <p>资料不足时显示范围、低把握或暂未评级，不把未知自动解释成“没有”。</p>
        </article>
      </section>

      <section className="release-method-note">
        <div>
          <p className="eyebrow">当前快照的特殊数据状态</p>
          <h2>D-UNCLEAR 不是现行规则类别。</h2>
        </div>
        <p>
          当前 {manifest.counts.dUnclearRatings.toLocaleString('zh-CN')} 条资料不足型 D 来自本次发布闭环，
          页面会把它显示为“具体雷点未确认”。它不在下面 50 条现行细则里，也不声称命中了任何 D 级剧情或设定事实。
        </p>
        <Link className="result-link" href="/works?grade=D">查看页面如何展示</Link>
      </section>

      <nav className="release-rule-jump" aria-label="跳到各等级规则">
        {gradeOrder.map((grade) => (
          <a className={`grade-outline-${grade}`} href={`#grade-${grade}`} key={grade}>
            {grade} · {classesForGrade(grade).length}
          </a>
        ))}
      </nav>

      <section className="ranked-collection-list release-rule-groups">
        {gradeOrder.map((grade) => {
          const gradeClasses = classesForGrade(grade)
          return (
            <section className="rank-group release-rule-group" id={`grade-${grade}`} key={grade}>
              <div className="rank-group-heading release-rule-group-heading">
                <div>
                  <p className="eyebrow">{grade === 'X' ? '最高风险 · 仅人工裁决' : `${grade} 级细则`}</p>
                  <h2>{grade}：{radarGradeLabels[grade]}</h2>
                  <p>{radarGradeSummaries[grade]}</p>
                </div>
                <span>{gradeClasses.length} 条</span>
              </div>
              <div className="release-rule-card-grid">
                {gradeClasses.map(([code, definition]) => {
                  const badges = classBadges(code, definition)
                  return (
                    <article className={`release-rule-card rule-grade-${grade}`} key={code}>
                      <div className="release-rule-code-row">
                        <code>{code}</code>
                        {badges.map((badge) => <span key={badge}>{badge}</span>)}
                      </div>
                      <h3>{definition.label}</h3>
                      <p>{definition.summary}</p>
                      <details>
                        <summary>展开完整判定边界</summary>
                        <div className="release-rule-boundaries">
                          <section>
                            <strong>纳入条件</strong>
                            <ul>{definition.inclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
                          </section>
                          <section>
                            <strong>排除条件</strong>
                            <ul>{definition.exclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
                          </section>
                          {definition.interpretationNotes.length ? (
                            <section>
                              <strong>解释说明</strong>
                              <ul>{definition.interpretationNotes.map((item) => <li key={item}>{item}</li>)}</ul>
                            </section>
                          ) : null}
                        </div>
                      </details>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </section>

      <section className="release-snapshot-note release-snapshot-note-public">
        <div>
          <p className="eyebrow">X 级边界</p>
          <h2>当前公开快照只发布 S–F。</h2>
        </div>
        <p>
          X 类要求完整证据链和人工裁决，不由机器自动分配。创作者历史风险也不能直接伪装成作品已经发生的剧情事实。
        </p>
      </section>
    </main>
  )
}
