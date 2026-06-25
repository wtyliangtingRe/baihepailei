import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import './styles.css'
import './covers.css'

export const metadata: Metadata = {
  title: 'Baihepailei',
  description: '百合排雷资料库。',
}

const navItems = [
  { href: '/browse', label: '资料库' },
  { href: '/works', label: '作品' },
  { href: '/creators', label: '创作者' },
  { href: '/organizations', label: '机构' },
  { href: '/terms', label: '名词解释' },
  { href: '/rules', label: '规则' },
  { href: '/search', label: '搜索' },
  { href: '/admin', label: '后台' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link className="site-title" href="/">
              Baihepailei
            </Link>
            <nav className="site-nav" aria-label="主导航">
              {navItems.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
