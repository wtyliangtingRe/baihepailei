'use client'

import { useFormStatus } from 'react-dom'

type PendingSubmitButtonProps = {
  idleLabel: string
  pendingLabel: string
  className?: string
}

export default function PendingSubmitButton({ idleLabel, pendingLabel, className = 'review-button review-button-primary' }: PendingSubmitButtonProps) {
  const { pending } = useFormStatus()
  return <button aria-disabled={pending} className={className} disabled={pending} type="submit">{pending ? pendingLabel : idleLabel}</button>
}
