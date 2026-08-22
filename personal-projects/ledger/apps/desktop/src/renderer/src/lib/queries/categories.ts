import type { LedgerClient, CategoryType } from '@ledger/shared'

export interface Category {
  id: string
  user_id: string
  name: string
  category_type: CategoryType
  monthly_goal: number
  color: string
}

export interface NewCategoryInput {
  user_id: string
  name: string
  category_type: CategoryType
  monthly_goal: number
  color: string
}

export interface UpdateCategoryInput {
  name?: string
  monthly_goal?: number
  color?: string
}

export function categoriesKey(userId: string) {
  return ['categories', userId] as const
}

export async function fetchCategories(supabase: LedgerClient, userId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, user_id, name, category_type, monthly_goal, color')
    .eq('user_id', userId)
    .order('name', { ascending: true })

  if (error) throw error
  return data
}

export async function createCategory(
  supabase: LedgerClient,
  input: NewCategoryInput
): Promise<void> {
  const { error } = await supabase.from('categories').insert(input)
  if (error) throw error
}

export async function updateCategory(
  supabase: LedgerClient,
  id: string,
  input: UpdateCategoryInput
): Promise<void> {
  const { error } = await supabase.from('categories').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(supabase: LedgerClient, id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}
