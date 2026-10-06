import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

const stamp = Date.now();
const owner = { email: `flow-owner-${stamp}@e2e.test`, password: 'flow-owner-pass-1', name: 'Flo Owner', biz: `Flow Realty ${stamp}` };
const agentEmail = `flow-agent-${stamp}@e2e.test`;
let inviteUrl = ''; let totpSecret = '';

function base32(s: string) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out: number[] = []; for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
const totp = (secret: string, stepOffset = 0) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + stepOffset)); const h = createHmac('sha1', base32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0'); };

test.describe.configure({ mode: 'serial' });

test('a new customer signs up and sees a guided checklist instead of an empty screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create a workspace' }).click();
  await page.getByLabel('Business name').fill(owner.biz); await page.getByLabel('Your name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email); await page.getByLabel(/Password/).fill(owner.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const onb = page.getByTestId('onboarding');
  await expect(onb).toContainText('Get set up (0/7)'); await expect(onb).toContainText('Connect a lead source');
  await expect(page.getByText('All caught up')).toBeVisible(); // and the empty Today screen is calm, not broken
  await page.getByLabel('Get set up').getByRole('link', { name: 'Do it' }).first().click();
  await expect(page).toHaveURL(/\/settings/);
});

test('connect a website form from the generated form: the secret is shown once with the webhook URL', async ({ page }) => {
  await page.goto('/login'); await page.getByLabel('Email').fill(owner.email); await page.getByLabel('Password').fill(owner.password); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Nothing connected yet.')).toBeVisible();
  await page.getByLabel('What do you want to connect?').selectOption({ label: 'Website form (webhook)' });
  await page.getByLabel('Name').fill('Landing page');
  await page.getByRole('button', { name: 'Connect' }).click();
  const rev = page.getByTestId('revealed');
  await expect(rev).toContainText('Landing page is connected'); await expect(rev).toContainText('Webhook URL'); await expect(rev).toContainText('/hooks/website-webhook/'); await expect(rev).toContainText('signingSecret');
  await rev.getByRole('button', { name: 'I copied them' }).click(); await expect(rev).toBeHidden();
  await expect(page.getByTestId('connection')).toContainText('Landing page');
  await page.reload(); expect(await page.content()).not.toContain('signingSecret'); // never shown again
});

test('invite a teammate: the link works once and lands the agent on a limited Today', async ({ page, browser }) => {
  await page.goto('/login'); await page.getByLabel('Email').fill(owner.email); await page.getByLabel('Password').fill(owner.password); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Settings' }).click(); await page.getByRole('tab', { name: 'Team' }).click();
  await page.getByLabel('Email').fill(agentEmail); await page.getByRole('button', { name: 'Create invite link' }).click();
  inviteUrl = (await page.getByTestId('invite-link').locator('code').innerText()).trim(); expect(inviteUrl).toMatch(/\/invite\//);
  await expect(page.getByLabel('Members')).toContainText('Flo Owner');
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3400' }); const p2 = await ctx.newPage();
  await p2.goto(new URL(inviteUrl).pathname);
  await p2.getByLabel('Your name').fill('Alex Agent'); await p2.getByLabel(/Choose a password/).fill('agent-flow-pass-1'); await p2.getByRole('button', { name: 'Join' }).click();
  await expect(p2.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(p2.getByRole('button', { name: 'Settings' })).toHaveCount(0); await expect(p2.getByTestId('onboarding')).toHaveCount(0);
  const p3 = await ctx.newPage(); await p3.goto(new URL(inviteUrl).pathname);
  await p3.getByLabel('Your name').fill('Again'); await p3.getByLabel(/Choose a password/).fill('agent-flow-pass-2'); await p3.getByRole('button', { name: 'Join' }).click();
  await expect(p3.getByText(/expired or was already used/)).toBeVisible(); // single use
  await ctx.close();
});

test('two-factor from the UI: enrol, get recovery codes once, then sign-in asks for the code', async ({ page }) => {
  await page.goto('/login'); await page.getByLabel('Email').fill(owner.email); await page.getByLabel('Password').fill(owner.password); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Set up' }).click();
  totpSecret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('6-digit code').fill('000000'); await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('status')).toContainText(/did not match/);
  await page.getByLabel('6-digit code').fill(totp(totpSecret)); await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery')).toContainText(/[0-9a-f]{5}-[0-9a-f]{5}/);
  await page.getByRole('button', { name: 'I saved them' }).click();
  await page.getByRole('button', { name: 'Today' }).click(); await page.getByRole('button', { name: 'Sign out' }).click();

  await page.goto('/login'); await page.getByLabel('Email').fill(owner.email); await page.getByLabel('Password').fill(owner.password); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel(/Authenticator code/)).toBeVisible();
  await page.getByLabel(/Authenticator code/).fill('123456'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That code did not work')).toBeVisible();
  await page.getByLabel(/Authenticator code/).fill(totp(totpSecret, 1)); await page.getByRole('button', { name: 'Sign in' }).click(); // next time step: the enrolment code cannot be replayed
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});
