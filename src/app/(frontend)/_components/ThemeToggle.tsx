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

  const label =
    theme === 'dark'
      ? '切换到白天模式'
      : '切换到夜间模式'

  return (
    <button
      aria-label={label}
      className="theme-toggle"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="theme-toggle-icon"
        viewBox="0 0 24 24"
      >
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M8.7 15.3a6 6 0 1 1 6.6 0C14.4 16 14 16.8 14 18h-4c0-1.2-.4-2-1.3-2.7Z" />
        <path d="M12 1v1M3.5 3.5l.8.8M20.5 3.5l-.8.8M1 12h1M22 12h1" />
      </svg>
    </button>
  )
}
