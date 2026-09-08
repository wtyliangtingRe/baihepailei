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
import './creators.css'

export const metadata: Metadata = {
  title: {
    default: '百合排雷 · Baihepailei',
    template: '%s · 百合排雷',
  },
  description: '查询百合作品的 S–F 评级、具体警示、作者机构与可核验资料来源。',
}

const navItems = [
  { href: '/works', label: '作品' },
  { href: '/ratings', label: '评级原则' },
  { href: '/recommendations', label: '安心向' },
  { href: '/updates', label: '最近更新' },
  { href: '/feedback', label: '补充纠错' },
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
          <div className="site-review-notice" role="note">
            <strong>AI 综合，待复核</strong>
            <span>评级与资料会随核验结果更新；请结合具体警示、依据与资料完整度阅读。</span>
          </div>
          {children}
          <footer className="site-footer">
            <div>
              <strong>百合排雷</strong>
              <span>百合作品资料、评级与内容警示。</span>
            </div>
            <nav aria-label="页脚导航">
              <Link href="/ratings">评级原则</Link>
              <Link href="/rules">完整规则</Link>
              <Link href="/radar">评级进度</Link>
              <Link href="/creators">作者 / 主创</Link>
              <Link href="/organizations">创作机构</Link>
              <Link href="/feedback">补充纠错</Link>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  )
}
