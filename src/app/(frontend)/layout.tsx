import type { Metadata } from 'next'
import React from 'react'

import './styles.css'

export const metadata: Metadata = {
  title: 'Baihepailei',
  description: 'A structured reference and review database.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
