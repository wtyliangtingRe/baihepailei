import Link from 'next/link'

import { readSiteFinanceReport, type FinanceEntry } from '@/lib/siteFinance'

export const dynamic = 'force-dynamic'

function formatAmount(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString('zh-CN')}`
  }
}

function total(entries: FinanceEntry[]) {
  return entries.reduce((sum, item) => sum + item.amount, 0)
}

function EntryList({ entries, currency, emptyText }: { entries: FinanceEntry[]; currency: string; emptyText: string }) {
  if (!entries.length) return <p className="muted">{emptyText}</p>
  return (
    <div className="account-meta">
      {entries.map((item, index) => (
        <div key={`${item.label}-${item.date || index}`}>
          <dt>{item.label}</dt>
          <dd>
            <strong>{formatAmount(item.amount, currency)}</strong>
            {item.date ? <span className="muted"> · {item.date}</span> : null}
            {item.note ? <small>{item.note}</small> : null}
          </dd>
        </div>
      ))}
    </div>
  )
}

export default function SupportPage() {
  const report = readSiteFinanceReport()
  const incomeTotal = total(report.income)
  const expenseTotal = total(report.expenses)
  const balance = incomeTotal - expenseTotal

  return (
    <main className="page collection-page support-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">网站运营</p>
          <h1>网站运营收支与支持</h1>
          <p>这里公开网站运行相关的收入、支出和自愿支持入口。没有录入的项目会明确标记为“尚未公开”，不会把未知金额误写成零。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/terms">返回站点说明</Link>
          <Link className="back-link" href="/feedback">提交问题</Link>
        </div>
      </section>

      {!report.configured ? (
        <section className="detail-card review-safety-note" role="status">
          <strong>公开账目尚未配置</strong>
          <p>当前页面只展示未来的公开结构，不代表网站支出为零。站务人员录入报告后，收入、支出和余额才会在这里显示。</p>
        </section>
      ) : null}

      <section className="detail-card">
        <h2>本期概览</h2>
        <p className="muted">期间：{report.period}{report.updatedAt ? ` · 最近更新：${report.updatedAt}` : ''}</p>
        <div className="review-stat-grid">
          <article className="review-stat"><span>收入</span><strong>{report.configured ? formatAmount(incomeTotal, report.currency) : '尚未录入'}</strong></article>
          <article className="review-stat"><span>支出</span><strong>{report.configured ? formatAmount(expenseTotal, report.currency) : '尚未录入'}</strong></article>
          <article className="review-stat"><span>本期结余</span><strong>{report.configured ? formatAmount(balance, report.currency) : '尚未计算'}</strong></article>
        </div>
      </section>

      <section className="collection-grid">
        <article className="detail-card">
          <h2>收入明细</h2>
          <EntryList entries={report.income} currency={report.currency} emptyText={report.configured ? '本期没有记录到收入。' : '尚未录入公开收入。'} />
        </article>
        <article className="detail-card">
          <h2>支出明细</h2>
          <EntryList entries={report.expenses} currency={report.currency} emptyText={report.configured ? '本期没有记录到支出。' : '尚未录入服务器、域名、备份或其他运营支出。'} />
        </article>
      </section>

      <section className="detail-card">
        <p className="eyebrow">自愿支持</p>
        <h2>{report.donation.label}</h2>
        <p>{report.donation.note}</p>
        {report.donation.enabled && report.donation.qrImage ? (
          <figure>
            <img
              alt="网站自愿支持二维码"
              height={280}
              loading="lazy"
              src={report.donation.qrImage}
              style={{ borderRadius: 18, height: 'auto', maxWidth: '100%' }}
              width={280}
            />
            <figcaption className="muted">请在付款前再次确认收款对象。站务人员不会以评级、加速审核或特殊权限作为捐赠回报。</figcaption>
          </figure>
        ) : (
          <p className="muted">捐赠二维码尚未启用。之后放入二维码图片并配置服务器变量即可显示。</p>
        )}
      </section>

      <section className="detail-card">
        <h2>公开原则</h2>
        <ul>
          <li>捐赠不影响作品评级、人工审核结论或反馈处理顺序。</li>
          <li>收入和支出按站务选择的公开期间汇总；敏感支付信息和个人资料不会公开。</li>
          <li>若未来存在广告、赞助或其他收入，会在收入明细中单独标记，不伪装成普通捐赠。</li>
          <li>账目有遗漏或错误时，可以通过反馈页面提交勘误。</li>
        </ul>
      </section>
    </main>
  )
}
