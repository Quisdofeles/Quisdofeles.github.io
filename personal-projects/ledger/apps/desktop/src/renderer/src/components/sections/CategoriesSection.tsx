import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CategoryType } from '@ledger/shared'
import { supabase } from '../../lib/supabaseClient'
import { formatCurrency } from '../../lib/format'
import { Card } from '../Card'
import { ConfirmDialog } from '../ConfirmDialog'
import { Modal } from '../Modal'
import { CategoryForm, type CategoryFormValues } from '../forms/CategoryForm'
import {
  categoriesKey,
  createCategory,
  deleteCategory,
  updateCategory,
  type Category
} from '../../lib/queries/categories'
import { monthTransactionsKeyPrefix } from '../../lib/queries/transactions'

interface CategoriesSectionProps {
  userId: string
  categories: Category[]
  byCategory: Record<string, number>
}

const VISIBLE_COUNT = 5

export function CategoriesSection({ userId, categories, byCategory }: CategoriesSectionProps) {
  const [editing, setEditing] = useState<Category | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null)
  const [expandedIncome, setExpandedIncome] = useState(false)
  const [expandedExpense, setExpandedExpense] = useState(false)
  const queryClient = useQueryClient()

  const incomeCategories = useMemo(
    () => categories.filter((category) => category.category_type === 'income'),
    [categories]
  )
  const expenseCategories = useMemo(
    () => categories.filter((category) => category.category_type === 'expense'),
    [categories]
  )

  function invalidateAfterChange() {
    queryClient.invalidateQueries({ queryKey: categoriesKey(userId) })
    queryClient.invalidateQueries({ queryKey: monthTransactionsKeyPrefix(userId) })
  }

  const createMutation = useMutation({
    mutationFn: (values: CategoryFormValues) =>
      createCategory(supabase, {
        user_id: userId,
        name: values.name,
        category_type: values.categoryType,
        monthly_goal: values.monthlyGoal,
        color: values.color
      }),
    onSuccess: () => {
      invalidateAfterChange()
      setAddModalOpen(false)
    }
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; values: CategoryFormValues }) =>
      updateCategory(supabase, input.id, {
        name: input.values.name,
        monthly_goal: input.values.monthlyGoal,
        color: input.values.color
      }),
    onSuccess: () => {
      invalidateAfterChange()
      setEditing(null)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(supabase, id),
    onSuccess: () => {
      invalidateAfterChange()
      setPendingDelete(null)
    }
  })

  function renderGroup(
    title: string,
    type: CategoryType,
    group: Category[],
    expanded: boolean,
    onToggleExpanded: () => void
  ) {
    const visible = expanded ? group : group.slice(0, VISIBLE_COUNT)

    return (
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h3>

        {group.length === 0 ? (
          <p className="text-sm text-text-muted">No {type} categories yet.</p>
        ) : (
          <div className="space-y-3">
            {visible.map((category) => {
              const actual = byCategory[category.id] ?? 0
              const goal = category.monthly_goal
              const toneClass = type === 'income' ? 'text-positive' : 'text-negative'
              const barClass = type === 'income' ? 'bg-positive' : 'bg-negative'
              const fillPercent = goal > 0 ? Math.min((actual / goal) * 100, 100) : 0

              return (
                <div key={category.id} className="rounded-lg bg-surface-raised p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="text-sm font-medium text-text">{category.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditing(category)}
                        className="text-xs text-text-muted hover:text-text"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPendingDelete(category)}
                        className="text-xs text-text-muted hover:text-negative"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex items-baseline justify-between">
                    <span className={`text-sm font-semibold ${toneClass}`}>
                      {formatCurrency(actual)}
                    </span>
                    <span className="text-xs text-text-muted">of {formatCurrency(goal)} goal</span>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {group.length > VISIBLE_COUNT && (
          <button
            onClick={onToggleExpanded}
            className="mt-3 text-sm text-text-muted hover:text-text"
          >
            {expanded ? 'Show less' : `Show all ${group.length}`}
          </button>
        )}
      </div>
    )
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text">Categories</h2>
        <button
          onClick={() => setAddModalOpen(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-strong"
        >
          + Add category
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {renderGroup(
          'Income categories',
          'income',
          incomeCategories,
          expandedIncome,
          () => setExpandedIncome((value) => !value)
        )}
        {renderGroup(
          'Expense categories',
          'expense',
          expenseCategories,
          expandedExpense,
          () => setExpandedExpense((value) => !value)
        )}
      </div>

      {addModalOpen && (
        <Modal title="Add category" onClose={() => setAddModalOpen(false)}>
          <CategoryForm
            categories={categories}
            onSubmit={(values) => createMutation.mutateAsync(values)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <CategoryForm
            initial={editing}
            categories={categories}
            onSubmit={(values) => updateMutation.mutateAsync({ id: editing.id, values })}
          />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${pendingDelete.name}"? Its past transactions become uncategorized.`}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Card>
  )
}
