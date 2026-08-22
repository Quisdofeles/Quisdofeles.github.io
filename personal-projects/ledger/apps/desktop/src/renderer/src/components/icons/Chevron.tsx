interface ChevronProps {
  className?: string
}

export function ChevronLeft({ className = 'h-3 w-3' }: ChevronProps) {
  return (
    <svg viewBox="0 0 8 12" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 1L2 6L7 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChevronRight({ className = 'h-3 w-3' }: ChevronProps) {
  return (
    <svg viewBox="0 0 8 12" fill="none" className={className} aria-hidden="true">
      <path
        d="M1 1L6 6L1 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
