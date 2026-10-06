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

test('the owner opens Pulse from Today and sees KPIs, the team board, leakage and sources', async ({ page }) => {
  await signIn(page, owner);
  await page.getByRole('button', { name: 'Pulse' }).click();
  await expect(page).toHaveURL(/\/pulse/);
  await expect(page.getByRole('heading', { name: 'Pulse' })).toBeVisible();
  for (const k of ['responseMedianS', 'connectRate', 'avgTalkS', 'conversionPct', 'followUpPct']) await expect(page.getByTestId(`kpi-${k}`)).toBeVisible();
  await expect(page.getByLabel('Team board')).toContainText('Asha Agent');
  await expect(page.getByLabel('Leakage')).toContainText('Untouched');
  await expect(page.getByLabel('Source quality')).toContainText('Manual entry');
  await page.getByRole('tab', { name: '30 days' }).click();
  await expect(page.getByRole('tab', { name: '30 days' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Agent scorecards')).toContainText('Asha Agent');
  expect(await page.content()).not.toMatch(/98123456\d\d/); // Pulse never shows phone numbers
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('agents have no Pulse button, are told Pulse is for managers, and see their own goal instead', async ({ page }) => {
  await signIn(page, agent);
  await expect(page.getByRole('button', { name: 'Pulse' })).toHaveCount(0);
  await expect(page.getByTestId('goal')).toContainText(/Today: \d+ \/ 10 actions/);
  await page.goto('/pulse');
  await expect(page.getByText('Pulse is for managers and owners.')).toBeVisible();
});

test('admins see workspace health with the alert rules\' numbers; agents do not', async ({ page }) => {
  await signIn(page, owner);
  await page.getByRole('button', { name: 'Health' }).click();
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  await expect(page.getByTestId('overall')).toBeVisible();
  await expect(page.getByLabel('Incoming events')).toContainText('waiting');
  await page.goto('/today'); await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, agent);
  await expect(page.getByRole('button', { name: 'Health' })).toHaveCount(0);
  await page.goto('/ops');
  await expect(page.getByText('Workspace health is for admins and owners.')).toBeVisible();
});
