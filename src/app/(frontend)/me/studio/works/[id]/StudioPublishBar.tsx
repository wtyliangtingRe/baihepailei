'use client'

import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

import styles from './StudioPublishBar.module.css'

type PublishAction = 'temporary' | 'save' | 'formal'
type WorkStage = 'temporary' | 'formal'

function editorForm() {
  return document.querySelector<HTMLFormElement>('form.review-editor-form')
}

function submitTarget() {
  return document.querySelector<HTMLElement>('form.review-editor-form .review-editor-submit')
}

function supersededElements(target: HTMLElement | null) {
  return {
    button: target?.querySelector<HTMLButtonElement>(':scope > button[type="submit"]') || null,
    note: target?.querySelector<HTMLElement>(':scope > span') || null,
  }
}

function setSelect(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name)
  if (!(field instanceof HTMLSelectElement)) return
  field.value = value
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

function setCheckbox(form: HTMLFormElement, name: string, checked: boolean) {
  const field = form.elements.namedItem(name)
  if (!(field instanceof HTMLInputElement) || field.type !== 'checkbox') return
  field.checked = checked
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

function hideTechnicalLifecycleFields(form: HTMLFormElement, hidden: boolean) {
  for (const name of ['_status', 'catalogStatus', 'isLiteVisible', 'isFullVisible']) {
    const field = form.elements.namedItem(name)
    if (!(field instanceof HTMLElement)) continue
    const wrapper = field.closest<HTMLElement>('label')
    if (wrapper) wrapper.hidden = hidden
  }
}

function workID(pathname: string) {
  return pathname.match(/^\/me\/studio\/works\/([^/?#]+)/u)?.[1] || ''
}

export default function StudioPublishBar() {
  const pathname = usePathname()
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState<PublishAction | null>(null)
  const [stage, setStage] = useState<WorkStage>('formal')
  const id = workID(pathname)

  useEffect(() => {
    setBusy(null)
    const frame = window.requestAnimationFrame(() => {
      const nextTarget = submitTarget()
      const form = editorForm()
      const old = supersededElements(nextTarget)
      if (old.button) old.button.hidden = true
      if (old.note) old.note.hidden = true
      if (form) hideTechnicalLifecycleFields(form, true)
      setTarget(nextTarget)
    })

    if (id) {
      fetch(`/api/studio/works/${encodeURIComponent(id)}/stage`, { credentials: 'same-origin' })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => {
          if (result?.stage === 'temporary' || result?.stage === 'formal') setStage(result.stage)
        })
        .catch(() => undefined)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      const old = supersededElements(submitTarget())
      if (old.button) old.button.hidden = false
      if (old.note) old.note.hidden = false
      const form = editorForm()
      if (form) hideTechnicalLifecycleFields(form, false)
      setTarget(null)
    }
  }, [id, pathname])

  if (!target) return null

  async function updateStage(nextStage: WorkStage) {
    if (!id) throw new Error('缺少作品 ID。')
    const response = await fetch(`/api/studio/works/${encodeURIComponent(id)}/stage`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: nextStage }),
    })
    const result = await response.json().catch(() => ({})) as { message?: string }
    if (!response.ok) throw new Error(result.message || '作品阶段更新失败。')
    setStage(nextStage)
  }

  async function submit(action: PublishAction) {
    const form = editorForm()
    if (!form || busy) return

    const confirmed = action === 'formal'
      ? window.confirm('保存并转为正式作品后，作品会继续公开并移除“临时作品”标记。确定继续吗？')
      : action === 'temporary'
        ? window.confirm('保存为临时作品后，作品仍会公开，但会明确标记为资料待补齐或待复核。确定继续吗？')
        : true
    if (!confirmed) return

    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }

    setBusy(action)
    try {
      if (action === 'temporary') await updateStage('temporary')
      if (action === 'formal') await updateStage('formal')
      setSelect(form, '_status', 'published')
      setSelect(form, 'catalogStatus', 'active')
      setCheckbox(form, 'isLiteVisible', true)
      setCheckbox(form, 'isFullVisible', true)
      form.requestSubmit()
      window.setTimeout(() => setBusy(null), 8000)
    } catch (error) {
      setBusy(null)
      window.alert(error instanceof Error ? error.message : '作品保存失败。')
    }
  }

  return createPortal(
    <div className={styles.bar} aria-label="作品保存与阶段操作">
      <div className={styles.copy}>
        <strong>保存作品</strong>
        <span>当前阶段：{stage === 'temporary' ? '临时作品' : '正式作品'}。所有非归档作品都会保持发布并进入前台。</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.draft} disabled={Boolean(busy)} onClick={() => void submit('temporary')} type="button">
          {busy === 'temporary' ? '正在保存临时作品……' : '保存为临时作品'}
        </button>
        <button className={styles.save} disabled={Boolean(busy)} onClick={() => void submit('save')} type="button">
          {busy === 'save' ? '正在保存……' : '保存当前阶段'}
        </button>
        <button className={styles.publish} disabled={Boolean(busy)} onClick={() => void submit('formal')} type="button">
          {busy === 'formal' ? '正在转为正式作品……' : '保存并转为正式作品'}
        </button>
      </div>
    </div>,
    target,
  )
}
