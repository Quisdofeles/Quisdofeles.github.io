import { formatCurrency } from '../lib/format'

interface StatTileProps {
  label: string
  value: number
  tone?: 'default' | 'positive' | 'negative'
}

const TONE_CLASSES: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'text-text',
  positive: 'text-positive',
  negative: 'text-negative'
}

export function StatTile({ label, value, tone = 'default' }: StatTileProps) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold whitespace-nowrap ${TONE_CLASSES[tone]}`}>
        {formatCurrency(value)}
      </p>
    </div>
  )
}
