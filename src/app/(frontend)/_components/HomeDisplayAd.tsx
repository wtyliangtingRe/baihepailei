'use client'

import Script from 'next/script'
import { useRef, useState } from 'react'

import { adsenseAccount } from '../_lib/adsense'

type AdSenseWindow = Window & {
  adsbygoogle?: { push: (options: Record<string, never>) => unknown }
}

let loaderFailed = false

export default function HomeDisplayAd() {
  const slotRef = useRef<HTMLModElement>(null)
  const requestedSlot = useRef<HTMLModElement | null>(null)
  const [unavailable, setUnavailable] = useState(loaderFailed)

  function requestAd() {
    const slot = slotRef.current
    if (!slot || requestedSlot.current === slot) return
    if (loaderFailed) {
      setUnavailable(true)
      return
    }
    requestedSlot.current = slot

    try {
      const adWindow = window as AdSenseWindow
      const queue = (adWindow.adsbygoogle ??= Array<Record<string, never>>())
      queue.push({})
    } catch {
      setUnavailable(true)
    }
  }

  if (unavailable) return null

  return (
    <aside aria-label="广告" className="release-home-ad">
      <span className="release-home-ad-label">广告</span>
      <ins
        ref={slotRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adsenseAccount}
        data-ad-slot="3201932616"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <Script
        id="home-adsense"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseAccount}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onLoad={requestAd}
        onReady={requestAd}
        onError={() => {
          loaderFailed = true
          setUnavailable(true)
        }}
      />
    </aside>
  )
}
