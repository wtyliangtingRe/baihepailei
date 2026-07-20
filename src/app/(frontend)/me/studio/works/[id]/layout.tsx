import type { ReactNode } from 'react'

import StudioPublishBar from './StudioPublishBar'

export default function StudioWorkEditorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StudioPublishBar />
      {children}
    </>
  )
}
