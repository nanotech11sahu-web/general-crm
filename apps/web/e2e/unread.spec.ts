import { expect, test } from '@playwright/test';

const agent = { email: 'agent@e2e.test', password: 'agent-pass-12345' };

test('a lead replying by SMS shows up as a Reply item, opens the thread, and reading it clears the item', async ({ page }) => {
  expect((await fetch('http://127.0.0.1:3301/inbound-reply', { method: 'POST' })).status).toBe(200);
  await page.goto('/login');
  await page.getByLabel('Email').fill(agent.email);
  await page.getByLabel('Password').fill(agent.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const current = page.getByTestId('current-item');
  await expect(current).toContainText('Reply Rani');
  await expect(current).toContainText('Replied on SMS');
  await expect(current).toContainText('Can you call me after 6?');
  expect(await page.content()).not.toMatch(/98123456\d\d/); // custody holds in the thread flow too

  await current.getByRole('button', { name: 'Reply' }).click();
  await expect(page).toHaveURL(/\/lead\//);
  await expect(page.getByRole('heading', { name: 'Reply Rani' })).toBeVisible();
  const thread = page.getByTestId('thread');
  await expect(thread.locator('[data-direction="in"]')).toContainText('Can you call me after 6?');
  // SMS can only go from an approved template: free text is not offered, Send is disabled until one is chosen
  await expect(page.getByLabel('Template')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(await page.content()).not.toMatch(/98123456\d\d/);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('All caught up')).toBeVisible({ timeout: 10_000 }); // the unread flag was cleared by opening the thread
});
