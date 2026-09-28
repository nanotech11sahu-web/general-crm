import { createOwnerContext } from '../test/helpers';
import { getOrCreateWallet, creditWallet, debitWallet, listWalletTransactions } from './wallet.service';

describe('Wallet service (shared credits ledger)', () => {
  it('creates a zero-balance wallet on first access', async () => {
    const { workspace } = await createOwnerContext();
    const wallet = await getOrCreateWallet(String(workspace._id));
    expect(wallet.balance).toBe(0);
  });

  it('credits the wallet and logs a transaction with the resulting balance', async () => {
    const { workspace } = await createOwnerContext();
    const { wallet, transaction } = await creditWallet(String(workspace._id), 100, 'top_up');
    expect(wallet.balance).toBe(100);
    expect(transaction.type).toBe('credit');
    expect(transaction.balanceAfter).toBe(100);
  });

  it('debits the wallet when sufficient balance exists', async () => {
    const { workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 50, 'top_up');
    const { wallet, transaction } = await debitWallet(String(workspace._id), 20, 'vibe_prospecting_search');
    expect(wallet.balance).toBe(30);
    expect(transaction.type).toBe('debit');
  });

  it('rejects a debit that would overdraw the wallet', async () => {
    const { workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 10, 'top_up');
    await expect(debitWallet(String(workspace._id), 20, 'vibe_prospecting_search')).rejects.toThrow('Insufficient wallet balance');
    const wallet = await getOrCreateWallet(String(workspace._id));
    expect(wallet.balance).toBe(10);
  });

  it('rejects non-positive credit/debit amounts', async () => {
    const { workspace } = await createOwnerContext();
    await expect(creditWallet(String(workspace._id), 0, 'top_up')).rejects.toThrow();
    await expect(debitWallet(String(workspace._id), -5, 'top_up')).rejects.toThrow();
  });

  it('lists transactions newest first', async () => {
    const { workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 10, 'top_up');
    await creditWallet(String(workspace._id), 5, 'top_up');
    const transactions = await listWalletTransactions(String(workspace._id));
    expect(transactions).toHaveLength(2);
    expect(transactions[0].balanceAfter).toBe(15);
    expect(transactions[1].balanceAfter).toBe(10);
  });

  it('keeps separate wallets per workspace', async () => {
    const a = await createOwnerContext('Wallet Workspace A');
    const b = await createOwnerContext('Wallet Workspace B');
    await creditWallet(String(a.workspace._id), 40, 'top_up');
    const walletA = await getOrCreateWallet(String(a.workspace._id));
    const walletB = await getOrCreateWallet(String(b.workspace._id));
    expect(walletA.balance).toBe(40);
    expect(walletB.balance).toBe(0);
  });
});
