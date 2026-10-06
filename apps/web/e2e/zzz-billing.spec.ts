import { expect, test, type Page } from '@playwright/test';

const owner = { email: 'owner@e2e.test', password: 'owner-pass-12345' };
const agent = { email: 'agent@e2e.test', password: 'agent-pass-12345' };
async function signIn(page: Page, c: { email: string; password: string }) {
  await page.goto('/login'); await page.getByLabel('Email').fill(c.email); await page.getByLabel('Password').fill(c.password); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('logged-out visitors see the landing page with live pricing and a path to the trial', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Never lose a lead/ })).toBeVisible();
  await expect(page.getByTestId('pricing')).toContainText('Starter'); await expect(page.getByTestId('pricing')).toContainText('Growth'); await expect(page.getByTestId('pricing')).toContainText('Scale');
  await expect(page.getByTestId('pricing')).toContainText('₹');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Start your 14-day free trial' }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test('a signed-in visitor skips the landing page; the billing page shows the trial, usage and plans; paying without a provider is explained, not broken', async ({ page }) => {
  await signIn(page, owner);
  await page.goto('/'); await expect(page).toHaveURL(/\/today/);
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByTestId('current-plan')).toContainText('Free trial'); await expect(page.getByTestId('current-plan')).toContainText('days left');
  await expect(page.getByTestId('current-plan')).toContainText(/Seats: \d+ of 5 used/);
  for (const k of ['starter', 'growth', 'scale']) await expect(page.getByTestId(`plan-${k}`)).toBeVisible();
  await page.getByTestId('plan-growth').getByRole('button', { name: 'Choose Growth' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /not set up|Contact support/ })).toBeVisible(); // e2e stack has no payment provider
});

test('sample data: one click to look around, one click to remove it; sample leads cannot be called', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3400' }); const page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto('/signup'); await page.getByLabel('Business name').fill(`Demo Co ${stamp}`); await page.getByLabel('Your name').fill('Dee Mo'); await page.getByLabel('Work email').fill(`demo-${stamp}@e2e.test`); await page.getByLabel(/Password/).fill('demo-owner-pass-1'); await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByRole('button', { name: 'Load sample data to look around' }).click();
  await expect(page.getByTestId('current-item')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Up next \(\d+\)/)).toBeVisible();
  await page.getByTestId('current-item').getByRole('button', { name: 'Call' }).click();
  await expect(page.getByText('Sample leads cannot be called')).toBeVisible();
  await page.getByRole('button', { name: 'Remove sample data' }).click();
  await expect(page.getByText('All caught up')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Load sample data to look around' })).toBeVisible();
  await ctx.close();
});

test('when the trial ends the workspace turns read-only with a clear message; reading and billing still work', async ({ page }) => {
  expect((await fetch('http://127.0.0.1:3301/expire-trial', { method: 'POST' })).status).toBe(200);
  await signIn(page, agent);
  await expect.poll(async () => page.getByTestId('readonly-banner').count(), { timeout: 20_000, intervals: [500, 1000] }).toBe(1); // entitlements are cached for up to 10 s
  await expect(page.getByTestId('readonly-banner')).toContainText('free trial has ended');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible(); // reading keeps working
  const cur = page.getByTestId('current-item');
  if (await cur.count()) { await cur.getByRole('button', { name: /^(Call|Reply|Log outcome)$/ }).first().click(); await expect(page.getByRole('alert').filter({ hasText: /trial has ended/ }).first()).toBeVisible(); }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, owner);
  await page.getByRole('link', { name: 'Open billing' }).click();
  await expect(page.getByTestId('current-plan')).toContainText('expired');
});
