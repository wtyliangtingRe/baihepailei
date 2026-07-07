'use client'

import { useEffect, useState } from 'react'

type ContentScope = 'ordinary' | 'all'

const storageKey = 'baihepailei-content-scope'

function readInitialScope(): ContentScope {
  if (typeof window === 'undefined') return 'ordinary'
  const saved = window.localStorage.getItem(storageKey)
  return saved === 'all' ? 'all' : 'ordinary'
}

function applyScope(scope: ContentScope) {
  document.documentElement.dataset.contentScope = scope
  window.dispatchEvent(new CustomEvent('baihepailei:content-scope-change', { detail: { scope } }))
}

export default function ContentScopeToggle() {
  const [scope, setScope] = useState<ContentScope>('ordinary')

  useEffect(() => {
    const initial = readInitialScope()
    setScope(initial)
    applyScope(initial)
  }, [])

  function toggleScope() {
    const next = scope === 'ordinary' ? 'all' : 'ordinary'
    setScope(next)
    window.localStorage.setItem(storageKey, next)
    applyScope(next)
  }

  const showAll = scope === 'all'

  return (
    <button
      aria-label={showAll ? '当前显示全部标记内容，点击切回普通作品' : '当前只显示普通作品，点击显示全部标记内容'}
      aria-pressed={showAll}
      className="content-scope-toggle"
      type="button"
      onClick={toggleScope}
    >
      {showAll ? '全部作品' : '普通作品'}
    </button>
  )
}
