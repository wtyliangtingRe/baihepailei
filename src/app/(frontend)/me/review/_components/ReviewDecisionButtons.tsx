'use client'

import { useFormStatus } from 'react-dom'

type ReviewDecision = {
  value: string
  label: string
  className?: string
  confirm?: string
}

export default function ReviewDecisionButtons({ actions }: { actions: ReviewDecision[] }) {
  const { pending } = useFormStatus()

  return (
    <div className="review-content-actions" aria-busy={pending}>
      {actions.map((action) => (
        <button
          className={action.className || 'review-button'}
          disabled={pending}
          key={action.value}
          name="intent"
          onClick={(event) => {
            if (action.confirm && !window.confirm(action.confirm)) event.preventDefault()
          }}
          type="submit"
          value={action.value}
        >
          {pending ? '正在保存……' : action.label}
        </button>
      ))}
    </div>
  )
}
