import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import './styles.css'

export const metadata: Metadata = {
  title: 'Baihepailei',
  description: 'A structured reference database.',
}

const navItems = [
  { href: '/browse', label: 'Browse' },
  { href: '/works', label: 'Works' },
  { href: '/search', label: 'Search' },
  { href: '/admin', label: 'Admin' },
]

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
