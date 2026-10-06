import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3300';
const owner = { email: 'owner@e2e.test', password: 'owner-pass-12345' };
const agent = { email: 'agent@e2e.test', password: 'agent-pass-12345' };

async function apiLogin(c: { email: string; password: string }) {
  const r = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
  return (await r.json()).accessToken as string;
}
async function signIn(page: Page, c = agent) {
  await page.addInitScript(() => { (window as unknown as { __leaddeskOpenDialer: () => void }).__leaddeskOpenDialer = () => undefined; }); // no phone dialer in a browser test
  await page.goto('/login');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}
const current = (page: Page) => page.getByTestId('current-item');

test.describe.configure({ mode: 'serial' });

test('rejects a wrong password, then signs in and shows the first lead with a reason', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(agent.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong email or password')).toBeVisible();
  await signIn(page);
  await expect(current(page)).toContainText('New lead');
  await expect(current(page)).toContainText(/Anita Desai|Rahul Mehta/);
  await expect(current(page)).toContainText(/New lead \d+ min ago/);
  await expect(page.getByText('Up next (1)')).toBeVisible();
  // custody: no phone number anywhere in the page
  expect(await page.content()).not.toMatch(/98123456\d\d/);
});

test('a lead that arrives while the agent is on the screen appears live, without a reload', async ({ page }) => {
  await signIn(page);
  await expect(page.getByLabel('Live updates on')).toBeVisible({ timeout: 10_000 });
  const tok = await apiLogin(owner);
  const r = await fetch(`${API}/v1/leads`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ name: 'Priya Live', city: 'Delhi', contacts: [{ value: '9812345672' }] }) });
  expect(r.status).toBe(201);
  await expect(page.getByText('New lead assigned to you')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Up next (2)')).toBeVisible({ timeout: 10_000 });
});

test('the full loop: call -> outcome sheet enforces a concrete next action -> next lead loads', async ({ page }) => {
  await signIn(page);
  const firstName = (await current(page).locator('.name').innerText()).trim();
  await current(page).getByRole('button', { name: 'Call' }).click();
  await expect(page.getByText('On a call')).toBeVisible();
  const href = await page.getByTestId('dial-link').getAttribute('href');
  expect(href).toMatch(/^tel:\+919812345\d{3}$/);
  await page.getByRole('button', { name: 'Call finished' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log outcome' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Call length');
  await sheet.getByRole('button', { name: 'Connected - Interested' }).click();
  await expect(sheet.getByLabel('What to do and why')).toBeVisible();
  // vague note => the server's message is shown next to the field
  await sheet.getByLabel('What to do and why').fill('call');
  await sheet.getByRole('button', { name: 'Save and next lead' }).click();
  await expect(sheet).toContainText(/at least 10 characters/);
  await sheet.getByLabel('What to do and why').fill('Asked for a brochure; confirm the Saturday site visit');
  await sheet.getByRole('button', { name: 'Save and next lead' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByText('Suggested next step')).toBeVisible();
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText('Status updated')).toBeVisible();
  await expect(current(page).locator('.name')).not.toHaveText(firstName); // next lead auto-loaded
});

test('dead-end outcome needs no next action; a skipped outcome stays pending (even after a reload) until logged', async ({ page }) => {
  await signIn(page);
  const name = (await current(page).locator('.name').innerText()).trim();
  await current(page).getByRole('button', { name: 'Call' }).click();
  await page.getByRole('button', { name: 'Call finished' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log outcome' });
  await sheet.getByRole('button', { name: 'Wrong Number' }).click();
  await expect(sheet.getByLabel('What to do and why')).toBeHidden();
  await sheet.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByText(/Skipped\. 2 skips left today/)).toBeVisible();
  // the lead is back at the top as "Log outcome", and survives a reload (server-side state)
  await expect(current(page)).toContainText('Log outcome');
  await expect(current(page)).toContainText(name);
  await page.reload();
  await expect(current(page)).toContainText('Log outcome');
  await current(page).getByRole('button', { name: 'Log outcome' }).click();
  await page.getByRole('dialog', { name: 'Log outcome' }).getByRole('button', { name: 'Wrong Number' }).click();
  await page.getByRole('button', { name: 'Save and next lead' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(current(page)).not.toContainText('Log outcome');
});

test('works out the rest of the queue and ends on "All caught up"', async ({ page }) => {
  await signIn(page);
  for (let i = 0; i < 3; i++) {
    if (await page.getByText('All caught up').isVisible()) break;
    await current(page).getByRole('button', { name: 'Call' }).click();
    await page.getByRole('button', { name: 'Call finished' }).click();
    const sheet = page.getByRole('dialog', { name: 'Log outcome' });
    await sheet.getByRole('button', { name: 'Wrong Number' }).click();
    await sheet.getByRole('button', { name: 'Save and next lead' }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }).catch(() => undefined);
  }
  await expect(page.getByText('All caught up')).toBeVisible();
});

test('is installable and mobile-friendly: manifest, service worker, offline fallback, no horizontal scroll, large tap targets', async ({ page, context }) => {
  await signIn(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/today' });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()), null, { timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const sizes = await page.getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...sizes.filter((h) => h > 0))).toBeGreaterThanOrEqual(36); // the small "Sign out" is 36; primary actions are 48+
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || true);
  await context.setOffline(true);
  await page.goto('/today').catch(() => undefined);
  await expect(page.getByText('You are offline')).toBeVisible();
  await context.setOffline(false);
});

test('sign out returns to login and protects the Today screen', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/today');
  await expect(page).toHaveURL(/\/login/);
});
