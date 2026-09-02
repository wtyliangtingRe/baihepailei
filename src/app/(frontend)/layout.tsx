import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import ThemeToggle from './_components/ThemeToggle'
import './styles.css'
import './account.css'
import './covers.css'
import './callouts.css'
import './works-filters.css'
import './updates.css'
import './feedback.css'
import './entity-relations.css'
import './comments.css'
import './work-conclusion.css'
import './work-assessment-trust.css'
import './work-assessment-split.css'
import './work-list.css'
import './recommendations.css'
import './profile-lists.css'
import './review-workbench.css'
import './review-editor.css'
import './review-editor-retirements.css'
import './catalog-improvements.css'
import './frontend-simplification.css'
import './detail-title-table.css'
import './content-scope.css'
import './theme.css'
import './detail-layout-fixes.css'
import './ui-visual-polish.css'
import './stewardship-notices.css'
import './radar.css'
import './release.css'

export const metadata: Metadata = {
  title: {
    default: '百合排雷 · Baihepailei',
    template: '%s · 百合排雷',
  },
  description: '基于可追溯研究资料的百合作品评级与排雷资料库。',
}

const navItems = [
  { href: '/works', label: '作品' },
  { href: '/ratings', label: '评级' },
  { href: '/radar', label: '数据状态' },
  { href: '/rules', label: '规则' },
  { href: '/recommendations', label: '推荐' },
  { href: '/updates', label: '最近更新' },
  { href: '/feedback', label: '发现线索' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-content-scope="ordinary" data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <div className="site-branding">
              <Link className="site-title" href="/">
                <span>百合排雷</span>
                <small>Baihepailei</small>
              </Link>
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
