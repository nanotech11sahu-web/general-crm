import { callGateway, _clearGatewayCacheForTests } from './aiGateway.service';
import { AiRequestLog } from '../models/AiRequestLog';
import { getOrCreateWallet, creditWallet } from './wallet.service';
import { createOwnerContext } from '../test/helpers';

describe('aiGateway.service', () => {
  beforeEach(() => _clearGatewayCacheForTests());

  it('generates deterministic content, logs the request, and debits the wallet for the default provider', async () => {
    const { workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');
    const walletBefore = await getOrCreateWallet(String(workspace._id));

    const result = await callGateway({
      workspaceId: String(workspace._id),
      purpose: 'nextBestAction',
      prompt: 'Suggest next best action',
      context: { lifecycleStage: 'Lead', temperature: 'Hot', leadScore: 80 },
    });

    expect(result.content).toContain('hot lead');
    expect(result.provider).toBe('internal');
    expect(result.model).toBe('pmc-gateway-v1');
    expect(result.cacheHit).toBe(false);
    expect(result.totalTokens).toBeGreaterThan(0);

    const walletAfter = await getOrCreateWallet(String(workspace._id));
    expect(walletAfter.balance).toBe(walletBefore.balance - 2);

    const log = await AiRequestLog.findOne({ workspaceId: workspace._id, purpose: 'nextBestAction' }).lean();
    expect(log).toBeTruthy();
    expect(log?.success).toBe(true);
  });

  it('serves a cached response on an identical call and does not debit the wallet twice', async () => {
    const { workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    await callGateway({ workspaceId: String(workspace._id), purpose: 'nextBestAction', prompt: 'same prompt', context: {} });
    const walletAfterFirst = await getOrCreateWallet(String(workspace._id));

    const second = await callGateway({ workspaceId: String(workspace._id), purpose: 'nextBestAction', prompt: 'same prompt', context: {} });
    expect(second.cacheHit).toBe(true);

    const walletAfterSecond = await getOrCreateWallet(String(workspace._id));
    expect(walletAfterSecond.balance).toBe(walletAfterFirst.balance);
  });

  it('throws when the wallet has insufficient balance for the default provider', async () => {
    const { workspace } = await createOwnerContext();
    // A fresh workspace wallet starts at 0 balance.
    await expect(
      callGateway({ workspaceId: String(workspace._id), purpose: 'nextBestAction', prompt: 'unique prompt to avoid cache hit', context: {} }),
    ).rejects.toThrow();
  });
});
