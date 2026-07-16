'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

type FeedbackFormProps = {
  initialCollection?: string
  initialSlug?: string
  initialTitle?: string
  initialPageUrl?: string
}

const feedbackTypes = [
  { value: 'radar_evidence', label: '人工排雷 / 新证据' },
  { value: 'rating_correction', label: '分级或规则纠错' },
  { value: 'new_work', label: '建议新增作品' },
  { value: 'content_correction', label: '资料错误' },
  { value: 'broken_link', label: '链接失效' },
  { value: 'display_problem', label: '页面问题' },
  { value: 'other', label: '其他' },
]

const grades = ['', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

function cleanLines(value: string) {
  return [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))]
}

export default function FeedbackForm({ initialCollection = 'works', initialSlug = '', initialTitle = '', initialPageUrl = '' }: FeedbackFormProps) {
  const [feedbackType, setFeedbackType] = useState('radar_evidence')
  const [targetTitle, setTargetTitle] = useState(initialTitle)
  const [targetSlug, setTargetSlug] = useState(initialSlug)
  const [pageUrl, setPageUrl] = useState(initialPageUrl)
  const [proposedGrade, setProposedGrade] = useState('')
  const [ruleCodes, setRuleCodes] = useState('')
  const [claim, setClaim] = useState('')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [evidenceLinks, setEvidenceLinks] = useState('')
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'login-required' | 'error'>('idle')
  const [submissionID, setSubmissionID] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('submitting')

    const rules = cleanLines(ruleCodes).map((code) => ({ code }))
    const links = cleanLines(evidenceLinks).map((url, index) => ({ label: `来源 ${index + 1}`, url }))

    try {
      const response = await fetch('/api/feedback-submissions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackType,
          targetCollection: initialCollection || 'works',
          targetSlug: targetSlug.trim(),
          targetTitle: targetTitle.trim(),
          pageUrl: pageUrl.trim(),
          proposedGrade: proposedGrade || undefined,
          matchedRuleCodes: rules,
          claim: claim.trim(),
          evidenceSummary: evidenceSummary.trim(),
          evidenceLinks: links,
          containsSpoilers,
        }),
      })

      if (response.status === 401 || response.status === 403) {
        setState('login-required')
        return
      }
      if (!response.ok) throw new Error('feedback-submit-failed')

      const payload = await response.json()
      const doc = payload?.doc || payload
      setSubmissionID(String(doc?.id || ''))
      setState('submitted')
    } catch {
      setState('error')
    }
  }

  if (state === 'submitted') {
    return (
      <section className="detail-card feedback-form feedback-success" aria-live="polite">
        <p className="eyebrow">提交成功</p>
        <h2>材料已经进入人工审核队列</h2>
        <p>编辑会核对来源、规则和条目身份。提交内容不会自动改变作品评级。</p>
        {submissionID ? <small>反馈编号：{submissionID}</small> : null}
        <button onClick={() => setState('idle')} type="button">继续提交</button>
      </section>
    )
  }

  return (
    <form className="detail-card feedback-form" onSubmit={submit}>
      <div>
        <p className="eyebrow">人工材料入口</p>
        <h2>提交排雷内容或纠错</h2>
        <p className="muted">请尽量提供可核验来源。建议等级只是用户建议，必须经过编辑审核后才能进入正式条目。</p>
      </div>

      <div className="feedback-form-grid">
        <label>
          反馈类型
          <select onChange={(event) => setFeedbackType(event.target.value)} value={feedbackType}>
            {feedbackTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          作品 / 页面名称
          <input maxLength={200} onChange={(event) => setTargetTitle(event.target.value)} required value={targetTitle} />
        </label>
        <label>
          作品 Slug（可选）
          <input maxLength={200} onChange={(event) => setTargetSlug(event.target.value)} value={targetSlug} />
        </label>
        <label>
          相关页面链接（可选）
          <input maxLength={500} onChange={(event) => setPageUrl(event.target.value)} type="url" value={pageUrl} />
        </label>
        <label>
          建议等级（可选）
          <select onChange={(event) => setProposedGrade(event.target.value)} value={proposedGrade}>
            {grades.map((grade) => <option key={grade || 'none'} value={grade}>{grade || '不指定'}</option>)}
          </select>
        </label>
      </div>

      <label>
        建议命中规则（可选，每行一个代码）
        <textarea maxLength={1600} onChange={(event) => setRuleCodes(event.target.value)} placeholder={'例如：\nE-MALE-INTIMACY\nF-YURI-BAIT'} value={ruleCodes} />
      </label>
      <label>
        希望网站核实的结论
        <textarea maxLength={4000} onChange={(event) => setClaim(event.target.value)} placeholder="请说明具体人物、章节、路线、结局或创作者信息，以及你认为对应哪一条排雷规则。" required value={claim} />
      </label>
      <label>
        证据说明
        <textarea maxLength={8000} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="说明来源是什么、证据出现在哪里、是否存在版本或路线差异。" value={evidenceSummary} />
      </label>
      <label>
        证据链接（每行一个）
        <textarea maxLength={6000} onChange={(event) => setEvidenceLinks(event.target.value)} placeholder={'https://...\nhttps://...'} value={evidenceLinks} />
      </label>
      <label className="feedback-check">
        <input checked={containsSpoilers} onChange={(event) => setContainsSpoilers(event.target.checked)} type="checkbox" />
        <span>内容包含剧情或结局剧透</span>
      </label>

      <div className="feedback-actions">
        <button disabled={state === 'submitting'} type="submit">{state === 'submitting' ? '提交中……' : '提交给人工审核'}</button>
        <Link href="/rules">查看完整排雷规则</Link>
      </div>
      {state === 'login-required' ? (
        <p className="feedback-message">需要先<Link href="/account/login?redirect=/feedback">登录或注册</Link>，才能提交人工材料。</p>
      ) : null}
      {state === 'error' ? <p className="feedback-message feedback-message-error">提交失败，请检查内容后稍后重试。</p> : null}
    </form>
  )
}
