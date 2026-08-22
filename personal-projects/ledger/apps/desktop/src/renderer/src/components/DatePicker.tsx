import { useRef, useState } from 'react'
import { addMonths, formatMonthLabel, startOfMonth, toDateOnlyString } from '../lib/date'
import { inputClass } from '../lib/formStyles'
import { useClickOutside } from '../lib/useClickOutside'
import { ChevronLeft, ChevronRight } from './icons/Chevron'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDisplay(value: string): string {
  return parseDateOnly(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function buildGrid(viewedMonth: Date): Array<Date | null> {
  const first = startOfMonth(viewedMonth)
  const daysInMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 0).getDate()
  const cells: Array<Date | null> = new Array(first.getDay()).fill(null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), day))
  }
  return cells
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewedMonth, setViewedMonth] = useState(() => startOfMonth(parseDateOnly(value)))
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setOpen(false))

  const cells = buildGrid(viewedMonth)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setViewedMonth(startOfMonth(parseDateOnly(value)))
          setOpen((current) => !current)
        }}
        className={`${inputClass} text-left`}
      >
        {formatDisplay(value)}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewedMonth((current) => addMonths(current, -1))}
              className="px-2 text-text-muted hover:text-text"
            >
              <ChevronLeft />
            </button>
            <p className="text-sm font-medium text-text">{formatMonthLabel(viewedMonth)}</p>
            <button
              type="button"
              onClick={() => setViewedMonth((current) => addMonths(current, 1))}
              className="px-2 text-text-muted hover:text-text"
            >
              <ChevronRight />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, index) => {
              if (!cell) return <span key={index} />
              const cellValue = toDateOnlyString(cell)
              const isSelected = cellValue === value

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    onChange(cellValue)
                    setOpen(false)
                  }}
                  className={`rounded-md py-1 text-xs ${
                    isSelected
                      ? 'bg-accent font-semibold text-bg'
                      : 'text-text hover:bg-surface-raised'
                  }`}
                >
                  {cell.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
