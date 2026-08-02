import { useState } from 'react';
import { Account, reconcileAccount } from '../../api/accounts';

export function AccountsSidebar({
  accounts,
  onReconciled,
}: {
  accounts: Account[];
  onReconciled: () => void;
}) {
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [result, setResult] = useState<string | null>(null);

  async function handleReconcile(accountId: string) {
    const response = await reconcileAccount(accountId, {
      newBalance,
      date: new Date().toISOString(),
    });
    setResult(`Дельта: ${response.delta}`);
    setReconcilingId(null);
    setNewBalance('');
    onReconciled();
  }

  return (
    <aside className="accounts-sidebar">
      <h2>Счета</h2>
      {accounts.map((account) => (
        <div className="account-card" key={account.id}>
          <div className="account-name">{account.name}</div>
          <div className="account-balance">
            {account.balance} {account.currency}
          </div>
          {reconcilingId === account.id ? (
            <div className="reconcile-form">
              <input
                aria-label={`Новый остаток для ${account.name}`}
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
              />
              <button onClick={() => handleReconcile(account.id)}>Сохранить</button>
            </div>
          ) : (
            <button onClick={() => setReconcilingId(account.id)}>Сверить →</button>
          )}
        </div>
      ))}
      {result && <p role="status">{result}</p>}
    </aside>
  );
}
