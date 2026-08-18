export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
  message?: string;
  error?: string;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  account_number?: string | null;
  branch?: string | null;
  ifsc?: string | null;
  account_type?: string;
  currency?: string;
  opening_balance?: number;
  notes?: string | null;
  is_active?: number | boolean;
  txn_count?: number;
  latest_balance?: number | null;
}

export interface BankTransaction {
  id: number;
  account_id: number;
  txn_date: string;
  value_date?: string;
  narration?: string;
  ref_no?: string | null;
  withdrawal: number;
  deposit: number;
  balance?: number | null;
  category?: string | null;
  category_source?: string | null;
  payee?: string | null;
  txn_type?: string | null;
  tags?: string | null;
  notes?: string | null;
  import_batch_id?: string | null;
  linked_transfer_id?: number | null;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
}

export interface CategoryRule {
  id?: number;
  pattern: string;
  match_field?: string;
  category: string;
  priority?: number;
  account_id?: number | null;
  is_active?: number | boolean;
}

export interface BankBudget {
  id?: number;
  category: string;
  amount: number;
  period_month?: string | null;
  account_id?: number | null;
  notes?: string | null;
  spent?: number;
  remaining?: number;
  pct?: number;
}

export type DatePreset = 'tm' | 'lm' | '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all' | 'custom';
export type PeriodGrain = 'month' | 'quarter' | 'year';

export type PeriodRow = {
  key: string;
  label: string;
  total_debit: number;
  total_credit: number;
  net: number;
  txn_count: number;
};

export const DEFAULT_BANK_CATEGORIES = [
  'Income_Interest_Bank',
  'Income_Interest_Bond',
  'Income_Salary_Payroll',
  'Income_Insurance_Payout',
  'Income_Other_Credit',
  'Income_Peer_UPI',
  'Income_Cashback_Card',
  'Expense_Tax_TDS',
  'Expense_Tax_GST',
  'Expense_Bank_Charges',
  'Expense_ATM_Cash',
  'Expense_Card_POS',
  'Expense_Insurance_Premium',
  'Expense_Loan_EMI',
  'Expense_Land_Purchase',
  'Expense_Land_Purchase_Cheque',
  'Expense_Cheque_Paid',
  'Expense_Other_Debit',
  'Expense_Peer_UPI',
  'Investment_MutualFund_Purchase',
  'Investment_MutualFund_Redemption',
  'Investment_Broker_Trading',
  'Investment_FD_Book',
  'Investment_FD_Close',
  'Transfer_Self_Own',
  'Transfer_Family_In',
  'Transfer_Family_Out',
  'Transfer_Family_Rent',
  'Transfer_Internal_Bank',
  'Transfer_Card_Payment',
  'Transfer_Other_In',
  'Transfer_Other_Out',
  'Bills_Telecom_Mobile',
  'Bills_Utility_Other',
  'Food_Delivery_Online',
  'Food_Cafe_Snacks',
  'Food_Dairy_Store',
  'Food_Grocery_Store',
  'Shopping_Online_Amazon',
  'Shopping_Online_Flipkart',
  'Shopping_Online_Other',
  'Shopping_Ads_Marketing',
  'Travel_Transit_Metro',
  'Travel_Transit_Bus',
  'Travel_Transit_Rail',
  'Travel_Cab_Ride',
  'Travel_Fuel_Petrol',
  'Recharge_Mobile_Prepaid',
  'Payment_International_PayPal',
  'Uncategorized'
];
