import Link from 'next/link'

import {
  getPublicReleaseManifest,
  PUBLIC_GRADES,
  type PublicGrade,
} from '@/lib/publicRelease'
import {
  gradeLabel,
  gradeSummary,
} from '@/lib/radar/publicPresentation'
import { radarClassEntries } from '@/lib/radar/ratingPolicy'

export const dynamic = 'force-dynamic'

const readingAdvice: Record<PublicGrade, string> = {
  S: '仍建议看一眼作品页的独立警示；S 说明中心关系已明确，不承诺作品没有任何令人不适的内容。',
  A: '适合优先浏览，但连载终局、开放结局或尚未正式确立的边界仍应结合细分类理解。',
  B: '先查看轻度条件来自男性邻接噪声、关系体验、创作者交付风险，还是仅有定位基线。',
  C: '重点确认百合是中心关系、配角关系、友情以上，还是仅在某条可规避路线中成立。',
  D: '必须区分具体 D 类警示与“资料不足型 D”；后者没有确认任何具体雷点。',
  E: '建议阅读具体警示后再决定观看或购买，尤其关注男性关系、路线污染和设定边界。',
  F: '建议先读完依据与来源；该层通常涉及终局、核心男性亲密、NTR 或实质欺诈。',
}

export default function RatingsPage() {
  const manifest = getPublicReleaseManifest()
  const total = manifest.counts.ratedWorks

  return (
    <main className="page collection-page ratings-public-page release-ratings-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">评级怎么读</p>
        <h1>等级给方向，警示给原因。</h1>
        <p>
          每部作品先按 S–F 给出核心结论，再用一个或多个细分类说明关系状态、设定或雷点。
          较低等级事实会拦截较高等级；“没查到”永远不等于“不存在”。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/works?status=rated">浏览 {total.toLocaleString('zh-CN')} 条评级</Link>
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
          <p>把结论范围、低把握和缺失细分类直接展示，不伪装成精确答案。</p>
        </article>
      </section>

      <section className="release-grade-distribution" aria-label="评级分布">
        {PUBLIC_GRADES.map((grade) => {
          const count = manifest.gradeCounts[grade]
          const percent = total ? (count / total) * 100 : 0
          const classCount = radarClassEntries.filter(([, definition]) => definition.grade === grade).length
          return (
            <article className="release-grade-row release-grade-row-detailed" key={grade}>
              <Link className={`rating-chip grade-${grade}`} href={`/works?grade=${grade}`}>{grade}</Link>
              <div className="release-grade-copy">
                <div>
                  <h2>{gradeLabel(grade)}</h2>
                  <strong>{count.toLocaleString('zh-CN')} 条 · {percent.toFixed(1)}%</strong>
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

      <section className="release-method-note release-d-unclear-note">
        <div>
          <p className="eyebrow">特别说明</p>
          <h2>D 级中有 {manifest.counts.dUnclearRatings.toLocaleString('zh-CN')} 条资料不足记录</h2>
        </div>
        <p>
          它们会显示“具体雷点未确认”，只代表现有资料还不能建立明确的女性关系拓扑。
          不能据此推断男性结局、NTR、异性路线或任何其他具体情节；这也是为什么作品页把数据边界和规则警示分开。
        </p>
        <Link className="result-link" href="/works?grade=D">查看 D 级作品</Link>
      </section>

      <section className="detail-card release-rating-principles">
        <p className="eyebrow">三个阅读原则</p>
        <h2>评级不是一个孤立字母。</h2>
        <ul>
          <li><strong>低等级拦截：</strong>若已确认 E/F 级事实，即使女性关系本身很强，也不能只展示较高等级。</li>
          <li><strong>多标签并存：</strong>同一作品可以同时有关系状态、男性关系、设定与企划风险标签。</li>
          <li><strong>未知保持未知：</strong>缺少细分资料时只公开已有等级，不用旧规则或标题印象补一个理由。</li>
        </ul>
      </section>
    </main>
  )
}

