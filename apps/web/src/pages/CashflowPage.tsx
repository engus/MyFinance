import { useCallback, useEffect, useState } from 'react';
import { Account, fetchAccounts } from '../api/accounts';
import { Category, fetchCategories } from '../api/categories';
import { Transaction, fetchTransactions } from '../api/transactions';
import { AccountsSidebar } from './cashflow/AccountsSidebar';
import { TransactionColumn } from './cashflow/TransactionColumn';
import '../styles/cashflow.css';

export function CashflowPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [income, setIncome] = useState<Transaction[]>([]);
  const [expense, setExpense] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [accountsData, categoriesData, incomeData, expenseData] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchTransactions({ kind: 'INCOME' }),
      fetchTransactions({ kind: 'EXPENSE' }),
    ]);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setIncome(incomeData);
    setExpense(expenseData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) return <p>Загрузка...</p>;

  return (
    <div className="cashflow-page">
      <div className="cashflow-transactions">
        <TransactionColumn
          title="Доход"
          kind="INCOME"
          transactions={income}
          accounts={accounts}
          categories={categories}
          onChanged={loadAll}
        />
        <TransactionColumn
          title="Расход"
          kind="EXPENSE"
          transactions={expense}
          accounts={accounts}
          categories={categories}
          onChanged={loadAll}
        />
      </div>
      <AccountsSidebar accounts={accounts} onReconciled={loadAll} />
    </div>
  );
}
