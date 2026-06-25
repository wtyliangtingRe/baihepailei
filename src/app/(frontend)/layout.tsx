import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import './styles.css'

export const metadata: Metadata = {
  title: 'Baihepailei',
  description: 'A structured reference database.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link className="site-title" href="/">
              Baihepailei
            </Link>
            <nav className="site-nav" aria-label="Main navigation">
              <Link href="/works">Works</Link>
              <Link href="/search">Search</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
