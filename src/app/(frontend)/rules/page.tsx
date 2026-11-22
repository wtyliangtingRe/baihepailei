import Link from 'next/link'

import {
  radarClassEntries,
  radarGradeLabels,
  radarGradeSummaries,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'

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
  return (
    <main className="page collection-page release-rules-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">v0.6 · 含现行增补</p>
        <h1>排雷规则</h1>
        <p>查看 {radarClassEntries.length} 条细则的证据要求和适用范围。</p>
        <div className="collection-actions">
          <Link className="result-link" href="/ratings">等级指南</Link>
          <Link className="back-link" href="/works?status=rated">查看已评级作品</Link>
        </div>
      </section>

      <section className="release-reading-model release-rules-model">
        <article>
          <span>事实优先</span>
          <h2>不能从类型印象反推剧情</h2>
          <p>标题、目录标签、社区 ship 或“没查到问题”都不能单独建立关系与雷点。彼此独立且一致的社区反馈可以支持判断；能核对作品、出处和上下文的原作截图等直接证据，即使由社区提供也可以采用。来源有分歧或证据不足时，会保留说明。</p>
        </article>
        <article>
          <span>低级拦截</span>
          <h2>严重事实不会被高分遮住</h2>
          <p>先按原作或官方授权资料预评，再以同一版本的社区记录核验。两边结论一致，标「官方来源」。出现分歧，取证据支持的较低等级，并标出支持该等级的来源。只有社区证据时，标「社区来源」。</p>
        </article>
        <article>
          <span>范围公开</span>
          <h2>未知不等于安全</h2>
          <p>可核实的情节按细则判级，同时注明已查到的卷数、路线或结局。尚在复核队列的作品会显示进度。只有完成检索后仍仅有名称的作品，才符合免予评级的条件。</p>
        </article>
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
