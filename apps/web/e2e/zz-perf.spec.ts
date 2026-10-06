import { expect, test } from '@playwright/test';

/**
 * Spec §18: the Today list renders in under 1 s on a mid-range Android phone. Emulated: 4x CPU slowdown and a ~1.6 Mbps / 150 ms RTT
 * connection. Measured the way agents actually open the app all day: an installed PWA with a session cookie, cold JS cache.
 */
test('Today renders within the 1 s budget on a throttled mid-range phone', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('agent@e2e.test'); await page.getByLabel('Password').fill('agent-pass-12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  const t0 = Date.now();
  await page.goto('/today');
  await expect(page.getByTestId('current-item').or(page.getByText('All caught up'))).toBeVisible({ timeout: 5000 });
  const ms = Date.now() - t0;
  console.log(`Today list visible ${ms} ms after opening the app (4x CPU, 150 ms RTT)`);
  expect(ms).toBeLessThan(1000);
});
