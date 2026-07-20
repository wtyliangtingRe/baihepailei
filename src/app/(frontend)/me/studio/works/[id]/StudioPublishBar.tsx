'use client'

import { useEffect, useState } from 'react'

import styles from './StudioPublishBar.module.css'

type PublishAction = 'draft' | 'save' | 'publish'

function editorForm() {
  return document.querySelector<HTMLFormElement>('form.review-editor-form')
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

export default function StudioPublishBar() {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState<PublishAction | null>(null)

  useEffect(() => {
    setAvailable(Boolean(editorForm()))
  }, [])

  if (!available) return null

  function submit(action: PublishAction) {
    const form = editorForm()
    if (!form || busy) return

    if (action === 'publish') {
      const confirmed = window.confirm('保存并发布会把作品设为正常目录、已发布，并开启 Lite 与完整版可见性。确定继续吗？')
      if (!confirmed) return
      setSelect(form, '_status', 'published')
      setSelect(form, 'catalogStatus', 'active')
      setCheckbox(form, 'isLiteVisible', true)
      setCheckbox(form, 'isFullVisible', true)
    } else if (action === 'draft') {
      setSelect(form, '_status', 'draft')
      setCheckbox(form, 'isLiteVisible', false)
      setCheckbox(form, 'isFullVisible', false)
    }

    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }

    setBusy(action)
    form.requestSubmit()
    window.setTimeout(() => setBusy(null), 8000)
  }

  return (
    <aside className={styles.bar} aria-label="作品保存与发布操作">
      <div className={styles.copy}>
        <strong>作品发布出口</strong>
        <span>“保存并发布”会自动完成发布状态、正常目录和前台可见性，不必再到下方组合多个开关。</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.draft} disabled={Boolean(busy)} onClick={() => submit('draft')} type="button">
          {busy === 'draft' ? '正在保存草稿……' : '保存为草稿'}
        </button>
        <button className={styles.save} disabled={Boolean(busy)} onClick={() => submit('save')} type="button">
          {busy === 'save' ? '正在保存……' : '保存当前设置'}
        </button>
        <button className={styles.publish} disabled={Boolean(busy)} onClick={() => submit('publish')} type="button">
          {busy === 'publish' ? '正在发布……' : '保存并发布'}
        </button>
      </div>
    </aside>
  )
}
