'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

import { adsenseAccount } from '../_lib/adsense'

type AdSenseWindow = Window & {
  adsbygoogle?: { push: (options: Record<string, never>) => unknown }
}

const unfilledGraceMs = 5_000
let loaderFailed = false

export default function DisplayAd() {
  const slotRef = useRef<HTMLModElement>(null)
  const requestedSlot = useRef<HTMLModElement | null>(null)
  const [unavailable, setUnavailable] = useState(loaderFailed)
  const [emptyConfirmed, setEmptyConfirmed] = useState(false)

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    let emptyTimer: number | undefined
    const checkStatus = () => {
      if (slot.dataset.adStatus !== 'unfilled') {
        window.clearTimeout(emptyTimer)
        emptyTimer = undefined
        setEmptyConfirmed(false)
        return
      }

      if (emptyTimer === undefined) {
        emptyTimer = window.setTimeout(() => {
          setEmptyConfirmed(slot.dataset.adStatus === 'unfilled')
        }, unfilledGraceMs)
      }
    }

    const observer = new MutationObserver(checkStatus)
    observer.observe(slot, { attributes: true, attributeFilter: ['data-ad-status'] })
    checkStatus()

    return () => {
      observer.disconnect()
      window.clearTimeout(emptyTimer)
    }
  }, [unavailable])

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
    <aside aria-label="广告" className="release-display-ad" data-empty={emptyConfirmed ? 'true' : undefined}>
      <span className="release-display-ad-label">广告</span>
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
        id="site-display-adsense"
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
