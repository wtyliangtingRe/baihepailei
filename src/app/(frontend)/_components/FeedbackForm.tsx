'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import {
  newWorkDatePrecisionOptions,
  newWorkFormatOptions,
  newWorkMediaGroupOptions,
  newWorkMediaTypeOptions,
  newWorkOptionLabel,
  sanitizeNewWorkProposalMetadata,
} from '@/lib/newWorkProposal'

import RadarRuleSelector from './RadarRuleSelector'

type FeedbackFormProps = {
  initialCollection?: string
  initialTitle?: string
  initialWorkId?: string
  initialType?: string
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

const feedbackTypeValues = new Set(feedbackTypes.map((item) => item.value))
const grades = ['', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

function cleanLines(value: string) {
  return [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))]
}

function sourceLinksFromLines(value: string) {
  return cleanLines(value).slice(0, 12).map((line, index) => {
    const separator = line.lastIndexOf('|')
    if (separator > 0) {
      const label = line.slice(0, separator).trim().slice(0, 120)
      const url = line.slice(separator + 1).trim().slice(0, 1000)
      if (url) return { label: label || `来源 ${index + 1}`, url }
    }
    return { label: `来源 ${index + 1}`, url: line.slice(0, 1000) }
  })
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) || '').trim()
}

function normalizedInitialType(value?: string) {
  return value && feedbackTypeValues.has(value) ? value : 'radar_evidence'
}

export default function FeedbackForm({ initialCollection = 'works', initialTitle = '', initialWorkId = '', initialType = '' }: FeedbackFormProps) {
  const router = useRouter()
  const [feedbackType, setFeedbackType] = useState(normalizedInitialType(initialType))
  const [targetTitle, setTargetTitle] = useState(initialTitle)
  const [targetWorkID, setTargetWorkID] = useState(initialWorkId)
  const [proposedGrade, setProposedGrade] = useState('')
  const [claim, setClaim] = useState('')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [evidenceLinks, setEvidenceLinks] = useState('')
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'login-required' | 'error'>('idle')
  const [submissionID, setSubmissionID] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const isNewWork = feedbackType === 'new_work'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('submitting')
    setErrorMessage('')

    const formData = new FormData(event.currentTarget)
    const decisiveRuleCode = String(formData.get('decisiveRuleCode') || '').trim()
    const selectedRuleCodes = formData.getAll('matchedRuleCodes').map(String).map((code) => code.trim()).filter(Boolean)
    const orderedRuleCodes = [...new Set([decisiveRuleCode, ...selectedRuleCodes].filter(Boolean))]
    const rules = orderedRuleCodes.map((code) => ({ code }))
    const links = sourceLinksFromLines(evidenceLinks)
    const workID = isNewWork ? '' : targetWorkID.trim()
    if (workID && !/^\d+$/u.test(workID)) {
      setErrorMessage('站内作品 ID 必须是作品详情页自动带入的数字主键。')
      setState('error')
      return
    }

    const newWorkMetadata = isNewWork
      ? sanitizeNewWorkProposalMetadata({
          originalTitle: formText(formData, 'newWorkOriginalTitle'),
          aliases: cleanLines(formText(formData, 'newWorkAliases')),
          mediaGroup: formText(formData, 'newWorkMediaGroup'),
          mediaType: formText(formData, 'newWorkMediaType'),
          format: formText(formData, 'newWorkFormat'),
          firstPublishedAt: formText(formData, 'newWorkFirstPublishedAt'),
          firstPublishedPrecision: formText(formData, 'newWorkFirstPublishedPrecision'),
          firstPublishedLabel: formText(formData, 'newWorkFirstPublishedLabel'),
          summary: formText(formData, 'newWorkSummary'),
          searchText: formText(formData, 'newWorkSearchText'),
        })
      : undefined

    try {
      const response = await fetch('/api/feedback-submissions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackType,
          linkedWork: workID ? Number(workID) : undefined,
          targetCollection: initialCollection || 'works',
          targetTitle: targetTitle.trim(),
          newWorkMetadata,
          proposedGrade: isNewWork ? undefined : proposedGrade || undefined,
          matchedRuleCodes: isNewWork ? [] : rules,
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
      if (!response.ok) {
        const failure = await response.json().catch(() => null)
        throw new Error(String(failure?.errors?.[0]?.message || '提交内容未通过校验，请检查站内作品 ID 和必填项。'))
      }

      const payload = await response.json()
      const doc = payload?.doc || payload
      setSubmissionID(String(doc?.id || ''))
      setState('submitted')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '提交失败，请稍后重试。')
      setState('error')
    }
  }

  if (state === 'submitted') {
    return (
      <section className="detail-card feedback-form feedback-success" aria-live="polite">
        <p className="eyebrow">提交成功</p>
        <h2>{isNewWork ? '新作品申请已经进入人工审核队列' : '材料已经进入人工审核队列'}</h2>
        <p>{isNewWork ? '你填写的标题、类型、日期、简介、别名和来源会保留在申请里。编辑会先检查重复条目，再用这些资料建立待复核草稿；申请不会直接公开。' : '编辑会核对来源、规则和条目身份。提交内容不会自动改变作品评级。'}</p>
        {submissionID ? <small>反馈编号：{submissionID}</small> : null}
        <div className="feedback-actions">
          <button onClick={() => router.back()} type="button">返回上一级</button>
          <button onClick={() => setState('idle')} type="button">继续提交</button>
        </div>
      </section>
    )
  }

  return (
    <form className="detail-card feedback-form" onSubmit={submit}>
      <div>
        <p className="eyebrow">{isNewWork ? '新作品申请' : '人工材料入口'}</p>
        <h2>{isNewWork ? '向资料库提交一份完整的新作品资料' : '提交排雷内容或纠错'}</h2>
        <p className="muted">{isNewWork ? '可以只填你确定的部分，也可以尽量完整地录入作品身份、类型、日期、简介、别名和来源。评级、规则命中、AI Radar 与发布状态由站内流程处理。' : '请尽量提供可核验来源。建议等级只是用户建议，必须经过编辑审核后才能进入正式条目。'}</p>
      </div>

      <div className="feedback-form-grid">
        <label>
          反馈类型
          <select onChange={(event) => setFeedbackType(event.target.value)} value={feedbackType}>
            {feedbackTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          {isNewWork ? '显示标题' : '作品 / 页面名称'}
          <input maxLength={200} onChange={(event) => setTargetTitle(event.target.value)} required value={targetTitle} />
        </label>
        {!isNewWork ? (
          <label>
            站内作品 ID（已有作品时填写）
            <input
              inputMode="numeric"
              maxLength={80}
              onChange={(event) => setTargetWorkID(event.target.value)}
              pattern="[0-9]+"
              placeholder="例如：31179"
              readOnly={Boolean(initialWorkId)}
              value={targetWorkID}
            />
            <small>从作品详情页进入时会自动填写；这是本站数据库主键，不依赖外部网站链接。</small>
          </label>
        ) : null}
        {!isNewWork ? (
          <label>
            建议等级（可选）
            <select onChange={(event) => setProposedGrade(event.target.value)} value={proposedGrade}>
              {grades.map((grade) => <option key={grade || 'none'} value={grade}>{grade || '不指定'}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {isNewWork ? (
        <>
          <section className="feedback-work-section">
            <header><h3>基础身份与别名</h3><p>这些字段会在编辑创建待复核草稿时自动带入。</p></header>
            <div className="feedback-form-grid">
              <label>原始标题<input maxLength={300} name="newWorkOriginalTitle" placeholder="作品最初发行时使用的标题" /></label>
              <label className="feedback-field-wide">别名与译名（每行一个）<textarea maxLength={12000} name="newWorkAliases" placeholder={'中文译名\n日本語タイトル\nEnglish title'} /></label>
              <label>作品大类<select defaultValue="unknown" name="newWorkMediaGroup">{newWorkMediaGroupOptions.map((value) => <option key={value} value={value}>{newWorkOptionLabel(value)}</option>)}</select></label>
              <label>作品类型<select defaultValue="unknown" name="newWorkMediaType">{newWorkMediaTypeOptions.map((value) => <option key={value} value={value}>{newWorkOptionLabel(value)}</option>)}</select></label>
              <label>作品形态<select defaultValue="unknown" name="newWorkFormat">{newWorkFormatOptions.map((value) => <option key={value} value={value}>{newWorkOptionLabel(value)}</option>)}</select></label>
            </div>
          </section>

          <section className="feedback-work-section">
            <header><h3>发行时间与作品简介</h3><p>日期不确定时可以只选精度，或在显示文本中记录“约 2019 年”等原始写法。</p></header>
            <div className="feedback-form-grid">
              <label>首次日期<input name="newWorkFirstPublishedAt" type="date" /></label>
              <label>日期精度<select defaultValue="unknown" name="newWorkFirstPublishedPrecision">{newWorkDatePrecisionOptions.map((value) => <option key={value} value={value}>{newWorkOptionLabel(value)}</option>)}</select></label>
              <label>日期显示文本<input maxLength={120} name="newWorkFirstPublishedLabel" placeholder="例如：2019 年春、2024-06" /></label>
              <label className="feedback-field-wide">作品简介（面向读者）<textarea maxLength={12000} name="newWorkSummary" placeholder="介绍故事前提、主要角色、题材和基本设定；不要在这里下评级结论。" /></label>
              <label className="feedback-field-wide">搜索补充文本与外部身份<input maxLength={30000} name="newWorkSearchText" placeholder="作者、制作方、平台、外部 ID、罗马字、关键词等，可用空格分隔。" /></label>
            </div>
          </section>
        </>
      ) : (
        <RadarRuleSelector
          description="第一项会作为主规则保存；展开后可同时勾选其他命中规则。它们只是提交建议，不会自动改正式评级。"
          title="建议命中规则（可选）"
        />
      )}

      <label>
        {isNewWork ? '收录理由与重复核查说明' : '希望网站核实的结论'}
        <textarea maxLength={4000} onChange={(event) => setClaim(event.target.value)} placeholder={isNewWork ? '说明为什么应当建立独立条目、是否查过本站同名作品、是否存在不同版本或跨媒体改编。' : '请说明具体人物、章节、路线、结局或创作者信息，以及你认为对应哪一条排雷规则。'} required value={claim} />
      </label>
      <label>
        {isNewWork ? '来源、版本与身份备注' : '证据说明'}
        <textarea maxLength={8000} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder={isNewWork ? '可填写作者、制作方、发行平台、语言、版本差异、外部数据库编号，以及来源之间不一致的地方。' : '说明来源是什么、证据出现在哪里、是否存在版本或路线差异。'} value={evidenceSummary} />
      </label>
      <label>
        {isNewWork ? '作品来源链接（每行一个）' : '证据链接（每行一个）'}
        <textarea maxLength={6000} onChange={(event) => setEvidenceLinks(event.target.value)} placeholder={'Bangumi | https://...\n官方网站 | https://...\nhttps://...'} value={evidenceLinks} />
        <small>可以写成“来源名称 | URL”，也可以只写 URL。最多保留 12 条。</small>
      </label>
      <label className="feedback-check">
        <input checked={containsSpoilers} onChange={(event) => setContainsSpoilers(event.target.checked)} type="checkbox" />
        <span>内容包含剧情或结局剧透</span>
      </label>

      <div className="feedback-actions">
        <button disabled={state === 'submitting'} type="submit">{state === 'submitting' ? '提交中……' : isNewWork ? '提交完整新作品申请' : '提交给人工审核'}</button>
        {isNewWork ? <Link href="/search">先搜索可能重复的作品</Link> : <Link href="/rules">查看完整排雷规则</Link>}
      </div>
      {state === 'login-required' ? (
        <p className="feedback-message">需要先<Link href={`/account/login?redirect=${encodeURIComponent(isNewWork ? '/feedback?type=new_work' : '/feedback')}`}>登录或注册</Link>，才能提交。</p>
      ) : null}
      {state === 'error' ? <p className="feedback-message feedback-message-error">{errorMessage || '提交失败，请检查内容后稍后重试。'}</p> : null}
    </form>
  )
}
