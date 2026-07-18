'use client'

import { useMemo, useState } from 'react'

import styles from './StewardshipNoticeSelector.module.css'

export type StewardshipNoticeOption = {
  id: string
  title: string
  category: string
  severity: string
  summary?: string
}

export default function StewardshipNoticeSelector({ notices, selectedIDs }: { notices: StewardshipNoticeOption[]; selectedIDs: string[] }) {
  const validIDs = useMemo(() => new Set(notices.map((notice) => notice.id)), [notices])
  const [selected, setSelected] = useState(() => new Set(selectedIDs.filter((id) => validIDs.has(id))))
  const [isOpen, setIsOpen] = useState(() => selectedIDs.some((id) => validIDs.has(id)))

  function toggle(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectedNotices = notices.filter((notice) => selected.has(notice.id))

  return (
    <div className={styles.selector} id="stewardship-notices">
      <a className={styles.jump} href="#stewardship-notices">站务提示 · 已选 {selected.size}</a>
      <div className={styles.status} aria-live="polite">
        <div>
          <strong>已选择 {selected.size} 条</strong>
          <span>{selected.size ? '点击页面底部“保存并同步前台”后生效。' : '当前不会显示额外站务提示。'}</span>
        </div>
        {selected.size ? <button onClick={() => setSelected(new Set())} type="button">清空选择</button> : null}
      </div>

      {selectedNotices.length ? (
        <div className={styles.selectedSummary} aria-label="当前已选提示">
          {selectedNotices.map((notice) => <span key={notice.id}>✓ {notice.title}</span>)}
        </div>
      ) : null}

      <details
        className={styles.details}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
        open={isOpen}
      >
        <summary>
          <span>选择站务与用语提示</span>
          <strong>{selected.size} 条已选</strong>
        </summary>
        <p>点击小三角展开列表。每条都有明确勾选状态，可同时选择多条。</p>
        <div className={styles.list}>
          {notices.map((notice) => {
            const isSelected = selected.has(notice.id)
            return (
              <label className={styles.option} data-selected={isSelected ? 'true' : 'false'} key={notice.id}>
                <input
                  checked={isSelected}
                  name="stewardshipNotices"
                  onChange={(event) => toggle(notice.id, event.currentTarget.checked)}
                  type="checkbox"
                  value={notice.id}
                />
                <span className={styles.checkmark} aria-hidden="true">{isSelected ? '✓' : ''}</span>
                <span className={styles.copy}>
                  <strong>{notice.title}</strong>
                  <small>{notice.category} · {notice.severity}</small>
                  {notice.summary ? <em>{notice.summary}</em> : null}
                </span>
                <span className={styles.badge}>{isSelected ? '已选' : '未选'}</span>
              </label>
            )
          })}
        </div>
      </details>
    </div>
  )
}
