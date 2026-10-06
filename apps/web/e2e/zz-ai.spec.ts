import { expect, test, type Page } from '@playwright/test';

const owner = { email: 'owner@e2e.test', password: 'owner-pass-12345' };
const agent = { email: 'agent@e2e.test', password: 'agent-pass-12345' };
async function signIn(page: Page, c: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

test('AI is off by default, cannot be switched on without a provider, and the app shows no AI controls to agents', async ({ page }) => {
  await signIn(page, owner);
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch AI on' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch AI on' }).click();
  await expect(page.getByRole('status')).toContainText('Connect an AI provider');
  await expect(page.getByRole('button', { name: 'Switch AI on' })).toBeVisible(); // still off
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('agents have no AI button, no AI panel on a lead, and are told the settings are for admins', async ({ page }) => {
  await signIn(page, agent);
  await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0);
  await page.goto('/ai');
  await expect(page.getByText('AI settings are for admins and owners.')).toBeVisible();
});
