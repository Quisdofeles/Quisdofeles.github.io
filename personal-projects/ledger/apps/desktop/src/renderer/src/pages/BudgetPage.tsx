import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { addMonths, formatMonthLabel, isSameMonth, startOfMonth } from '../lib/date'
import { deriveMonthAggregates } from '../lib/deriveMonthAggregates'
import { fetchMonthTransactions, monthTransactionsKey } from '../lib/queries/transactions'
import { categoriesKey, fetchCategories } from '../lib/queries/categories'
import { subscriptionsKey, fetchSubscriptions } from '../lib/queries/subscriptions'
import { SummarySection } from '../components/sections/SummarySection'
import { TransactionsSection } from '../components/sections/TransactionsSection'
import { CategoriesSection } from '../components/sections/CategoriesSection'
import { SubscriptionsSection } from '../components/sections/SubscriptionsSection'
import { AnalyticsSection } from '../components/sections/AnalyticsSection'
import { ChevronLeft, ChevronRight } from '../components/icons/Chevron'

interface BudgetPageProps {
  userId: string
}

export function BudgetPage({ userId }: BudgetPageProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const isCurrentMonth = isSameMonth(month, startOfMonth(new Date()))

  const transactionsQuery = useQuery({
    queryKey: monthTransactionsKey(userId, month),
    queryFn: () => fetchMonthTransactions(supabase, userId, month)
  })

  const categoriesQuery = useQuery({
    queryKey: categoriesKey(userId),
    queryFn: () => fetchCategories(supabase, userId)
  })

  const subscriptionsQuery = useQuery({
    queryKey: subscriptionsKey(userId),
    queryFn: () => fetchSubscriptions(supabase, userId)
  })

  const transactions = transactionsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const subscriptions = subscriptionsQuery.data ?? []
  const aggregates = deriveMonthAggregates(transactions)

  return (
    <div className="bg-bg text-text">
      <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-center gap-3 px-8">
          <button
            onClick={() => setMonth((current) => addMonths(current, -1))}
            className="gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
          >
            <ChevronLeft />
            Prev
          </button>
          <p className="w-36 text-center text-sm font-medium text-text">
            {formatMonthLabel(month)}
          </p>
          <button
            onClick={() => setMonth((current) => addMonths(current, 1))}
            disabled={isCurrentMonth}
            className="gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted transition hover:bg-surface-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
          >
            Next
            <ChevronRight />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-8 py-8">
        {transactionsQuery.error && (
          <p className="text-sm text-negative">
            Couldn't load transactions: {(transactionsQuery.error as Error).message}
          </p>
        )}
        {categoriesQuery.error && (
          <p className="text-sm text-negative">
            Couldn't load categories: {(categoriesQuery.error as Error).message}
          </p>
        )}

        <SummarySection aggregates={aggregates} month={month} />

        <AnalyticsSection categories={categories} byCategory={aggregates.byCategory} />

        <TransactionsSection
          userId={userId}
          month={month}
          transactions={transactions}
          categories={categories}
        />

        <CategoriesSection userId={userId} categories={categories} byCategory={aggregates.byCategory} />

        <SubscriptionsSection userId={userId} subscriptions={subscriptions} />
      </main>
    </div>
  )
}
