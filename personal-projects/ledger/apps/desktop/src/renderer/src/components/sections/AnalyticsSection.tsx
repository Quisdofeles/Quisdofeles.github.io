import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { CategoryType } from '@ledger/shared'
import { Card } from '../Card'
import { formatCurrency } from '../../lib/format'
import type { Category } from '../../lib/queries/categories'

interface AnalyticsSectionProps {
  categories: Category[]
  byCategory: Record<string, number>
}

interface DonutEntry {
  name: string
  value: number
  color: string
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#181c26',
    border: '1px solid #232838',
    borderRadius: '8px',
    color: '#e7eaf2'
  },
  itemStyle: { color: '#e7eaf2' },
  labelStyle: { color: '#8a92a6' }
}

function DonutBreakdown({ title, data }: { title: string; data: DonutEntry[] }) {
  const donutTotal = data.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>

      {data.length === 0 ? (
        <p className="text-sm text-text-muted">No {title.toLowerCase()} yet.</p>
      ) : (
        <div className="flex items-center gap-5">
          <div className="h-32 w-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="60%"
                  outerRadius="90%"
                  paddingAngle={2}
                  stroke="#12151d"
                  strokeWidth={2}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} {...TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="min-w-0 flex-1 space-y-2">
            {data.map((entry) => {
              const percent = donutTotal > 0 ? Math.round((entry.value / donutTotal) * 100) : 0

              return (
                <li key={entry.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-text">{entry.name}</span>
                  <span className="text-text-muted">{percent}%</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function buildDonutData(
  categories: Category[],
  byCategory: Record<string, number>,
  type: CategoryType
): DonutEntry[] {
  return categories
    .filter((category) => category.category_type === type)
    .map((category) => ({
      name: category.name,
      value: byCategory[category.id] ?? 0,
      color: category.color
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
}

export function AnalyticsSection({ categories, byCategory }: AnalyticsSectionProps) {
  const incomeData = buildDonutData(categories, byCategory, 'income')
  const expenseData = buildDonutData(categories, byCategory, 'expense')

  return (
    <Card padding="lg">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-text">Analytics</h2>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <DonutBreakdown title="Income" data={incomeData} />
        <DonutBreakdown title="Expenses" data={expenseData} />
      </div>
    </Card>
  )
}
