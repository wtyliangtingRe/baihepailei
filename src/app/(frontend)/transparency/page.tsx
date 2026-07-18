import Link from 'next/link'

import { readDetailIndex } from '../_lib/detail-index'

export const dynamic = 'force-dynamic'

function formatDate(value?: string) {
  if (!value) return '尚未生成'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="review-stat"><span>{label}</span><strong>{value.toLocaleString('zh-CN')}</strong></article>
}

export default function TransparencyPage() {
  const index = readDetailIndex()
  const items = index?.items || []
  const works = items.filter((item) => item.collection === 'works')
  const creators = items.filter((item) => item.collection === 'creators')
  const organizations = items.filter((item) => item.collection === 'organizations')
  const humanReviewed = works.filter((item) => item.reviewStatus === 'reviewed' || item.ratingNotice === 'manual_reviewed').length
  const aiPending = works.filter((item) => item.ratingNotice === 'ai_synthesized_pending_review').length
  const disputed = works.filter((item) => item.reviewStatus === 'disputed').length

  return (
    <main className="page collection-page transparency-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">站务与治理</p>
          <h1>透明度报告</h1>
          <p>这里说明本站如何区分 AI 建议与人工结论、如何处理用户反馈、条目隐藏和公开索引，以及当前数据快照有哪些限制。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/terms">返回站点说明</Link>
          <Link className="back-link" href="/rules">查看排雷规则</Link>
          <Link className="back-link" href="/feedback">提交纠错</Link>
        </div>
      </section>

      <section className="detail-card">
        <h2>当前索引快照</h2>
        <p className="muted">生成时间：{formatDate(index?.generatedAt)} · 模式：{index?.mode || '未知'} · 配置：{index?.profile || '未知'}</p>
        <div className="review-stat-grid">
          <Metric label="作品" value={works.length} />
          <Metric label="创作者" value={creators.length} />
          <Metric label="机构" value={organizations.length} />
          <Metric label="人工已复核作品" value={humanReviewed} />
          <Metric label="AI 综合待复核" value={aiPending} />
          <Metric label="有争议作品" value={disputed} />
        </div>
      </section>

      <section className="collection-grid">
        <article className="detail-card"><h2>AI 与人工审核</h2><ul><li>AI 研究和规则建议始终标为非正式建议，不自动覆盖正式等级。</li><li>人工审核结论、AI 原始建议和证据状态应分开显示并保留审计线索。</li><li>人工已确认的数据不会被后续批量 AI 导入覆盖。</li></ul></article>
        <article className="detail-card"><h2>反馈与新作品</h2><ul><li>用户提交进入独立反馈队列，不会直接修改正式作品。</li><li>“已采纳”表示材料成立；编辑仍需明确落实到作品或创建待复核草稿。</li><li>提交者可以提供来源、证据和纠错理由，站务人员保留审核说明。</li></ul></article>
        <article className="detail-card"><h2>隐藏、恢复与合并</h2><ul><li>日常“删除”使用可恢复的软隐藏，不永久删除资料。</li><li>重复作品合并必须经过候选扫描和人工确认，不能只按标题自动合并。</li><li>永久删除和高风险治理只开放给最高领袖与管理员。</li></ul></article>
        <article className="detail-card"><h2>站务提示与特殊裁量</h2><ul><li>站务与用语提示用于身份争议、版本差异、编辑裁量和异常状态。</li><li>提示可以关联多条，但不能替代评级规则、来源或证据材料。</li><li>新增、停用和修改提示会保留版本历史，公开页面只显示已启用内容。</li></ul></article>
      </section>

      <section className="detail-card">
        <h2>这份报告不代表什么</h2>
        <p>索引数量是当前生成文件的快照，不等于所有数据库记录都已公开，也不代表所有条目都完成了人工复核。评级是排雷结论，不是作品艺术质量评分；置信度也不是“安全概率”。</p>
      </section>
    </main>
  )
}
