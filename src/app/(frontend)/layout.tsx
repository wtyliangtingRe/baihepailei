import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import ContentScopeToggle from './_components/ContentScopeToggle'
import ThemeToggle from './_components/ThemeToggle'
import './styles.css'
import './covers.css'
import './callouts.css'
import './works-filters.css'
import './updates.css'
import './feedback.css'
import './entity-relations.css'
import './comments.css'
import './xwiki-renderer.css'
import './work-conclusion.css'
import './work-risk-matrix.css'
import './work-assessment-trust.css'
import './work-list.css'
import './recommendations.css'
import './profile-lists.css'
import './frontend-simplification.css'
import './detail-title-table.css'
import './content-scope.css'
import './theme.css'
import './detail-layout-fixes.css'
import './ui-visual-assets.css'
import './ui-visual-polish.css'

export const metadata: Metadata = {
  title: 'Baihepailei',
  description: '百合排雷资料库。',
}

const navItems = [
  { href: '/browse', label: '资料库' },
  { href: '/works', label: '作品' },
  { href: '/creators', label: '创作者' },
  { href: '/organizations', label: '机构' },
  { href: '/terms', label: '站点说明' },
  { href: '/recommendations', label: '推荐' },
  { href: '/me/lists', label: '我的列表' },
  { href: '/updates', label: '最近更新' },
  { href: '/feedback', label: '反馈' },
  { href: '/search', label: '搜索' },
  { href: '/admin', label: '后台' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-content-scope="ordinary" data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <div className="site-branding">
              <Link className="site-title" href="/">
                Baihepailei
              </Link>
              <ContentScopeToggle />
            </div>
            <nav className="site-nav" aria-label="主导航">
              {navItems.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
              <ThemeToggle />
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
