import { useRef, useState } from 'react'
import { inputClass } from '../lib/formStyles'
import { useClickOutside } from '../lib/useClickOutside'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
}

export function Select({ value, onChange, options, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setOpen(false))

  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`${inputClass} flex items-center justify-between`}
      >
        <span className={selectedLabel ? 'text-text' : 'text-text-muted'}>
          {selectedLabel ?? placeholder ?? ''}
        </span>
        <span className="text-text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface p-1 shadow-2xl">
          {placeholder && (
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                value === ''
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-surface-raised hover:text-text'
              }`}
            >
              {placeholder}
            </button>
          )}
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                value === option.value
                  ? 'bg-accent/10 text-accent'
                  : 'text-text hover:bg-surface-raised'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
