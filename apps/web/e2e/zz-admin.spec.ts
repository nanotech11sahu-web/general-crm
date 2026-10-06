import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3400' }); page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto('/signup'); await page.getByLabel('Business name').fill(`Admin Co ${stamp}`); await page.getByLabel('Your name').fill('Ada Min'); await page.getByLabel('Work email').fill(`admin-${stamp}@e2e.test`); await page.getByLabel(/Password/).fill('admin-owner-pass-1'); await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
});

test('pipeline: add and reorder a status, add a custom field', async () => {
  await page.getByRole('button', { name: 'Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await page.getByLabel('New status name').fill('Site visit booked'); await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByTestId('statuses')).toContainText('Site visit booked');
  await page.getByRole('button', { name: 'Move Site visit booked up' }).click();
  await expect(page.getByTestId('statuses').locator('li').nth(-2)).toContainText('Site visit booked');
  await page.getByLabel('Field key').fill('plot_size'); await page.getByLabel('Field label').fill('Plot size'); await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByTestId('custom-fields')).toContainText('Plot size');
});

test('routing: save a rule and an SLA policy; templates: save a draft', async () => {
  await page.getByRole('tab', { name: 'Routing & SLA' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule 1 name').fill('Meta to round robin'); await page.getByLabel('Rule 1 sources').fill('meta_leadads');
  await page.getByRole('button', { name: 'Save rules' }).click(); await expect(page.getByText('Rules saved')).toBeVisible();
  await page.getByRole('button', { name: 'Add policy' }).click(); await page.getByLabel('SLA 1 claim minutes').fill('5'); await page.getByLabel('SLA 1 first contact minutes').fill('15');
  await page.getByRole('button', { name: 'Save SLA' }).click(); await expect(page.getByText('SLA saved')).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: 'Routing & SLA' }).click();
  await expect(page.getByLabel('Rule 1 name')).toHaveValue('Meta to round robin'); await expect(page.getByLabel('SLA 1 claim minutes')).toHaveValue('5');

  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByLabel('Template name').fill('first_hello'); await page.getByLabel('Template text').fill('Hi {{1}}, thanks for your enquiry!'); await page.getByLabel('Template variables').fill('name');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('templates')).toContainText('first_hello'); await expect(page.getByTestId('templates')).toContainText('draft');
});

test('automation: a cadence can be created; team: a team can be created', async () => {
  await page.getByRole('tab', { name: 'Automation' }).click();
  await page.getByRole('button', { name: 'New cadence' }).click(); await page.getByLabel('Cadence name').fill('No answer follow-up');
  await page.getByRole('button', { name: 'Save cadence' }).click();
  await expect(page.getByTestId('cadences')).toContainText('No answer follow-up');
  await page.getByRole('tab', { name: 'Team' }).click();
  await page.getByLabel('New team name').fill('North'); await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByTestId('teams')).toContainText('North');
});

test('import: upload, map, dry run, import; leads list: search, save a view, bulk tag', async () => {
  await page.getByRole('tab', { name: 'Import' }).click();
  const csv = 'Full Name,Mobile,City\nAsha Rao,9811100001,Pune\nBilal Khan,9811100002,Mumbai\nChitra Nair,9811100003,Pune\n';
  await page.setInputFiles('#import-file', { name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/Match your columns \(3 rows\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Check (dry run)' }).click();
  await expect(page.getByTestId('dry-run')).toContainText('3 new');
  await page.getByRole('button', { name: /Import 3 leads/ }).click();
  await expect(page.getByTestId('import-status')).toContainText(/completed|done/i, { timeout: 20_000 });

  await page.goto('/leads');
  await expect(page.getByTestId('lead-list').locator('li')).toHaveCount(3);
  await page.getByLabel('Search leads').fill('Bilal'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('lead-list').locator('li')).toHaveCount(1);
  let n = 0; const h = (d: import('@playwright/test').Dialog) => { if (n++ === 0) void d.accept('Bilal only'); else void d.dismiss(); }; page.on('dialog', h);
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByText('View saved')).toBeVisible(); page.off('dialog', h);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('lead-list').locator('li')).toHaveCount(3);
  await page.getByLabel('Select Asha Rao').check(); await page.getByLabel('Select Chitra Nair').check();
  page.once('dialog', (d) => d.accept('hot'));
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByText(/Tagged: 2 leads/)).toBeVisible();
  await expect(page.getByTestId('lead-list')).toContainText('hot');
});
