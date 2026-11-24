import Link from 'next/link'

import {
  getPublicReleaseManifest,
  getPublicWorkList,
  PUBLIC_GRADES,
  type PublicGrade,
} from '@/lib/publicRelease'
import {
  gradeLabel,
  gradeSummary,
} from '@/lib/radar/publicPresentation'
import { radarClassEntries } from '@/lib/radar/ratingPolicy'
import { PUBLIC_TAG_KEYS, publicTagDefinitions } from '@/lib/radar/publicTags'

export const dynamic = 'force-dynamic'

const readingAdvice: Record<PublicGrade, string> = {
  S: '仍建议看一眼作品页的独立警示；S 说明中心关系已明确，不承诺作品没有任何令人不适的内容。',
  A: '适合优先浏览，但连载终局、开放结局或尚未正式确立的边界仍应结合细分类理解。',
  B: '查看本作的百合定位、女性暧昧情节或其他轻度条件。',
  C: '查看评级依据是本作的主要角色、女性关系、路线，还是同一人物在前传或续作中的经历。',
  D: '查看细分类，区分一般向收录、支线百合和影响主要关系的具体情节。',
  E: '建议阅读具体警示后再决定观看或购买，尤其关注男性关系、路线污染和设定边界。',
  F: '建议先读完依据与来源；该层通常涉及终局、核心男性亲密、NTR 或实质欺诈。',
}

export default function RatingsPage() {
  const manifest = getPublicReleaseManifest()
  const gradeCounts = Object.fromEntries(
    PUBLIC_GRADES.map((grade) => [
      grade,
      getPublicWorkList({ grade, status: 'rated', limit: 1 }).total,
    ]),
  ) as Record<PublicGrade, number>
  const total = PUBLIC_GRADES.reduce((sum, grade) => sum + gradeCounts[grade], 0)

  return (
    <main className="page collection-page ratings-public-page release-ratings-page">
      <section className="page-heading collection-heading">
        <h1>评级原则</h1>
        <p>
          每部作品先按 S–F 给出核心结论，再用一个或多个细分类说明关系状态、设定或雷点。
          同时符合多个等级时，以已确认的较低等级为准；资料不足的部分请结合待补信息阅读。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/works?status=rated">浏览 {total.toLocaleString('zh-CN')} 部已评级作品</Link>
          <Link className="back-link" href="/rules">查看全部细则与判定边界</Link>
        </div>
      </section>

      <section className="release-reading-model">
        <article>
          <span>第一层</span>
          <h2>S–F 核心等级</h2>
          <p>快速回答“这部作品对百合用户大致处于什么风险区间”。</p>
        </article>
        <article>
          <span>第二层</span>
          <h2>具体警示标签</h2>
          <p>回答“为什么是这个等级”，同一作品可以同时命中多条细则。</p>
        </article>
        <article>
          <span>资料边界</span>
          <h2>范围与待补充</h2>
          <p>了解评级适用的剧情与版本范围，以及资料把握和待补信息。</p>
        </article>
      </section>

      <section className="release-grade-distribution" aria-label="评级分布">
        {PUBLIC_GRADES.map((grade) => {
          const count = gradeCounts[grade]
          const percent = total ? (count / total) * 100 : 0
          const classCount = radarClassEntries.filter(([, definition]) => definition.grade === grade).length
          return (
            <article className="release-grade-row release-grade-row-detailed" key={grade}>
              <Link className={`rating-chip grade-${grade}`} href={`/works?grade=${grade}`}>{grade}</Link>
              <div className="release-grade-copy">
                <div>
                  <h2>{gradeLabel(grade)}</h2>
                  <strong>{count.toLocaleString('zh-CN')} 部 · {percent.toFixed(1)}%</strong>
                </div>
                <p>{gradeSummary(grade)}</p>
                <p className="release-reading-advice">{readingAdvice[grade]}</p>
                <div className="release-grade-actions">
                  <Link href={`/works?grade=${grade}`}>查看 {grade} 级作品</Link>
                  <Link href={`/rules#grade-${grade}`}>查看 {classCount} 条 {grade} 级细则</Link>
                </div>
                <div className="release-grade-track" aria-hidden="true">
                  <span className={`grade-bg-${grade}`} style={{ width: `${percent}%` }} />
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <section className="detail-card">
        <h2>评级来源</h2>
        <p>先看原作和官方资料，再用社区记录核验。两类来源支持同一等级时标「官方来源」。结论不同时，取较低等级，标出支持这个等级的来源。</p>
        <div className="collection-actions">
          <Link href="/works?source=official">查看官方来源作品</Link>
          <Link href="/works?source=community">查看社区来源作品</Link>
        </div>
      </section>
      <section className="detail-card release-preference-layer">
        <div className="release-section-heading release-section-heading-top">
          <div>
            <p className="eyebrow">独立偏好层</p>
            <h2>设定与成人内容</h2>
          </div>
        </div>
        <p className="release-grade-explanation">
          这些标签回答“作品是否包含我个人介意的设定或内容”，与核心关系评级分开展示。
          只有逐作品资料已经确认时才会出现在作品页；没有标签不等于已经确认不存在。
        </p>
        <div className="release-preference-grid">
          {PUBLIC_TAG_KEYS.filter(key => publicTagDefinitions[key].group !== '评级来源').map((key) => {
            const tag = publicTagDefinitions[key]
            return (
              <article key={key}>
                <span>{tag.group}</span>
                <strong>{tag.label}</strong>
                <p>{tag.description}</p>
              </article>
            )
          })}
        </div>
      </section>

      {manifest.counts.dUnclearRatings > 0 ? <section className="release-method-note release-d-unclear-note">
        <div>
          <p className="eyebrow">特别说明</p>
          <h2>资料不足型 D</h2>
        </div>
        <p>
          当前发布源数据中有 {manifest.counts.dUnclearRatings.toLocaleString('zh-CN')} 条 D-UNCLEAR 评级记录；
          去重后的作品页会显示“具体雷点未确认”。它只代表现有资料还不能建立明确的女性关系拓扑，
          不能据此推断男性结局、NTR、异性路线或任何其他具体情节。
        </p>
        <Link className="result-link" href="/works?grade=D">查看 D 级作品</Link>
      </section> : null}

      <section className="detail-card release-rating-principles">
        <p className="eyebrow">三个阅读原则</p>
        <h2>结合等级、标签与资料范围阅读</h2>
        <ul>
          <li><strong>低等级拦截：</strong>若已确认 E/F 级事实，即使女性关系本身很强，核心评级仍以较低等级为准。</li>
          <li><strong>多标签并存：</strong>最终等级内，有证据支持的细则可以全部列出。</li>
          <li><strong>资料完整度：</strong>标有“待补充”或“具体雷点未确认”的条目，仍需进一步核实。</li>
        </ul>
      </section>
    </main>
  )
}
