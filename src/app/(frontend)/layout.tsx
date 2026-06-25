import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import './styles.css'

export const metadata: Metadata = {
  title: '百合作品排雷',
  description: '百合作品、创作者、术语和排雷规则资料库。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link className="site-title" href="/">
              百合作品排雷
            </Link>
            <nav className="site-nav" aria-label="主导航">
              <Link href="/search">搜索</Link>
              <Link href="/admin">后台</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
