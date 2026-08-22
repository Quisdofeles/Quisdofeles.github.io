// Hand-written to match supabase/migrations/*.sql exactly.
// Once the CLI has a fresh access token, regenerate the authoritative
// version with `npm run gen:types` and replace this file wholesale.

export type TransactionType = 'income' | 'expense'
export type CategoryType = 'income' | 'expense'
export type BillingFrequency = 'weekly' | 'monthly' | 'yearly'
export type SavingsGoalType = 'want' | 'reserve'
export type SavingsContributionType = 'deposit' | 'withdrawal'
export type DebtType = 'student_loan' | 'car_loan' | 'mortgage' | 'other'
export type DebtPaymentType = 'reduce' | 'extend'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          display_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          user_id: string
          name: string
          category_type: CategoryType
          monthly_goal: number
          color: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          category_type: CategoryType
          monthly_goal?: number
          color: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          category_type?: CategoryType
          monthly_goal?: number
          color?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          category_id: string | null
          amount: number
          type: TransactionType
          transaction_date: string
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category_id?: string | null
          amount: number
          type: TransactionType
          transaction_date?: string
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          category_id?: string | null
          amount?: number
          type?: TransactionType
          transaction_date?: string
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'transactions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          }
        ]
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          category_id: string | null
          name: string
          amount: number
          billing_frequency: BillingFrequency
          next_charge_date: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category_id?: string | null
          name: string
          amount: number
          billing_frequency: BillingFrequency
          next_charge_date: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          category_id?: string | null
          name?: string
          amount?: number
          billing_frequency?: BillingFrequency
          next_charge_date?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subscriptions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          }
        ]
      }
      savings_goals: {
        Row: {
          id: string
          user_id: string
          name: string
          notes: string | null
          goal_type: SavingsGoalType
          target_amount: number
          current_amount: number
          monthly_contribution_target: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          notes?: string | null
          goal_type?: SavingsGoalType
          target_amount: number
          current_amount?: number
          monthly_contribution_target?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          notes?: string | null
          goal_type?: SavingsGoalType
          target_amount?: number
          current_amount?: number
          monthly_contribution_target?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      savings_contributions: {
        Row: {
          id: string
          savings_goal_id: string
          amount: number
          type: SavingsContributionType
          contribution_date: string
          created_at: string
        }
        Insert: {
          id?: string
          savings_goal_id: string
          amount: number
          type: SavingsContributionType
          contribution_date?: string
          created_at?: string
        }
        Update: {
          id?: string
          savings_goal_id?: string
          amount?: number
          type?: SavingsContributionType
          contribution_date?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'savings_contributions_savings_goal_id_fkey'
            columns: ['savings_goal_id']
            isOneToOne: false
            referencedRelation: 'savings_goals'
            referencedColumns: ['id']
          }
        ]
      }
      debts: {
        Row: {
          id: string
          user_id: string
          name: string
          notes: string | null
          debt_type: DebtType | null
          original_amount: number
          current_balance: number
          interest_rate: number | null
          monthly_payment: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          notes?: string | null
          debt_type?: DebtType | null
          original_amount: number
          current_balance?: number
          interest_rate?: number | null
          monthly_payment?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          notes?: string | null
          debt_type?: DebtType | null
          original_amount?: number
          current_balance?: number
          interest_rate?: number | null
          monthly_payment?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_payments: {
        Row: {
          id: string
          debt_id: string
          amount: number
          type: DebtPaymentType
          payment_date: string
          created_at: string
        }
        Insert: {
          id?: string
          debt_id: string
          amount: number
          type: DebtPaymentType
          payment_date?: string
          created_at?: string
        }
        Update: {
          id?: string
          debt_id?: string
          amount?: number
          type?: DebtPaymentType
          payment_date?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'debt_payments_debt_id_fkey'
            columns: ['debt_id']
            isOneToOne: false
            referencedRelation: 'debts'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
