'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem('baihepailei-theme')
  return saved === 'light' ? 'light' : 'dark'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const initial = readInitialTheme()
    setTheme(initial)
    document.documentElement.dataset.theme = initial
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    window.localStorage.setItem('baihepailei-theme', next)
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="切换明暗模式">
      {theme === 'dark' ? '白天模式' : '夜间模式'}
    </button>
  )
}
