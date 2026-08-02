import { useCallback, useEffect, useState } from 'react';
import { Account, fetchAccounts } from '../api/accounts';
import { Category, fetchCategories } from '../api/categories';
import { Transaction, fetchTransactions } from '../api/transactions';
import { AccountsSidebar } from './cashflow/AccountsSidebar';
import '../styles/cashflow.css';

export function CashflowPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [accountsData, categoriesData, transactionsData] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchTransactions(),
    ]);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setTransactions(transactionsData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) return <p>Загрузка...</p>;

  return (
    <div className="cashflow-page">
      <div className="cashflow-transactions">
        <p>
          Загружено категорий: {categories.length}, транзакций: {transactions.length}. Списки
          Income/Expense появятся в следующей задаче.
        </p>
      </div>
      <AccountsSidebar accounts={accounts} onReconciled={loadAll} />
    </div>
  );
}
