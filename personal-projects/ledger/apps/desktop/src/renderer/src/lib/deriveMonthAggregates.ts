import type { TransactionWithCategory } from './queries/transactions'

export interface MonthAggregates {
  income: number
  expenses: number
  balance: number
  byCategory: Record<string, number>
}

// Summing many stored 2-decimal amounts in floating point can drift by a
// fraction of a cent (e.g. 0.1 + 0.2 !== 0.3). Round explicitly here so every
// aggregate is exactly cent-precise, not just cent-precise-looking once
// formatCurrency happens to round it for display.
function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function deriveMonthAggregates(transactions: TransactionWithCategory[]): MonthAggregates {
  let income = 0
  let expenses = 0
  const byCategory: Record<string, number> = {}

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      income += transaction.amount
    } else {
      expenses += transaction.amount
    }

    if (transaction.category_id) {
      byCategory[transaction.category_id] = (byCategory[transaction.category_id] ?? 0) + transaction.amount
    }
  }

  for (const categoryId of Object.keys(byCategory)) {
    byCategory[categoryId] = roundToCents(byCategory[categoryId])
  }

  income = roundToCents(income)
  expenses = roundToCents(expenses)

  return { income, expenses, balance: roundToCents(income - expenses), byCategory }
}
