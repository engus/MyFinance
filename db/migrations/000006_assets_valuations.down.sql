DROP TABLE IF EXISTS asset_valuations;
DROP TABLE IF EXISTS assets;

ALTER TABLE ledger_transactions
    DROP CONSTRAINT ledger_transactions_type_valid,
    ADD CONSTRAINT ledger_transactions_type_valid CHECK (
        transaction_type IN (
            'OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER',
            'ASSET_PURCHASE', 'RECONCILIATION', 'REVERSAL'
        )
    );
