import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: 'default' | 'lg'
}

const PADDING_CLASSES: Record<NonNullable<CardProps['padding']>, string> = {
  default: 'p-6',
  lg: 'p-8'
}

export function Card({ children, className = '', padding = 'default' }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${PADDING_CLASSES[padding]} ${className}`}>
      {children}
    </div>
  )
}
