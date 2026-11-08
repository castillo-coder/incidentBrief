import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'New incident', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New incident' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog
    .getByLabel('Description', { exact: true })
    .fill('Requests are slower than expected. The root cause is unknown.');
  await dialog.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('high');
  await dialog.getByRole('button', { name: 'Create incident' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function remove(page: Page) {
  await page.getByRole('button', { name: 'Delete incident', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: /Every incident/ })).toBeVisible();
}
test('records an investigation, restores its session, edits, drafts, filters and deletes', async ({
  page,
  context,
}, info) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: info.outputPath('login.png'), fullPage: true });
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear place to start.' })).toBeVisible();
  await create(page, 'Payment provider latency');
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Payment provider latency',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel('New investigation note')
    .fill('Dependency traces show a timeout. <script>window.injected = true</script>');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('Dependency traces show a timeout.');
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  await page.getByRole('button', { name: 'Edit incident', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit incident' });
  await dialog.getByLabel('Title', { exact: true }).fill('Payment dependency timeout');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('resolved');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Payment dependency timeout',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.getByRole('status')).toContainText('Draft complete.');
  await expect(page.getByLabel('Summary draft')).toContainText('Root cause is unknown.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy draft' }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Known facts');
  await page.screenshot({
    path: info.outputPath('detail.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'All incidents', exact: true }).click();
  await expect(page.getByRole('link', { name: /Payment dependency timeout/ })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('journal.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No open incidents.' })).toBeVisible();
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await page.getByRole('link', { name: /Payment dependency timeout/ }).click();
  await page.getByRole('button', { name: /Delete note:/ }).click();
  await expect(page.getByText('No notes yet. Your next finding belongs here.')).toBeVisible();
  await remove(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('paginates incidents and notes without duplicate rows', async ({ page }) => {
  await signIn(page);
  const session = (await (await page.request.get('/api/auth/session')).json()) as {
    csrf_token: string;
  };
  const headers = { origin, 'x-csrf-token': session.csrf_token };
  const ids: string[] = [];
  try {
    await Promise.all(
      Array.from({ length: 23 }, async (_, index) => {
        const response = await page.request.post('/api/incidents', {
          headers,
          data: {
            title: `Pagination ${index}`,
            description: 'Synthetic pagination record.',
            severity: 'low',
          },
        });
        expect(response.status()).toBe(201);
        ids.push(((await response.json()) as { id: string }).id);
      }),
    );
    await page.reload();
    await expect(page.locator('.incident-row')).toHaveCount(20);
    await page.getByRole('button', { name: 'Load more incidents' }).click();
    await expect(page.locator('.incident-row')).toHaveCount(23);
    expect(
      new Set(
        await page
          .locator('.incident-row')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('href'))),
      ).size,
    ).toBe(23);
    const id = ids[0]!;
    await Promise.all(
      Array.from({ length: 23 }, (_, index) =>
        page.request.post(`/api/incidents/${id}/notes`, {
          headers,
          data: { body: `Finding ${index}` },
        }),
      ),
    );
    await page.goto(`/#/incidents/${id}`);
    await expect(page.locator('.notes-list li')).toHaveCount(20);
    await page.getByRole('button', { name: 'Load more notes' }).click();
    await expect(page.locator('.notes-list li')).toHaveCount(23);
  } finally {
    await Promise.all(ids.map((id) => page.request.delete(`/api/incidents/${id}`, { headers })));
  }
});

test('marks cancelled and failed summaries incomplete and allows another generation', async ({
  page,
}) => {
  await signIn(page);
  await create(page, '[slow stream] Cancel generation');
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.getByLabel('Summary draft')).toContainText('Known facts');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(page.getByRole('status')).toContainText('This draft is incomplete.');
  await expect(page.getByRole('button', { name: 'Copy draft' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate again' }).click();
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await expect(page.getByLabel('Summary draft')).toContainText('Known facts');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await remove(page);
  await create(page, '[provider failure] Partial generation');
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(page.getByRole('status')).toContainText('Generation did not finish.');
  await expect(page.getByRole('alert')).toContainText('The summary could not be completed.');
  await expect(page.getByLabel('Summary draft')).toContainText('Known facts');
  await expect(page.getByRole('button', { name: 'Copy draft' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('private-provider-message');
  await remove(page);
});

test('handles missing records and revoked sessions', async ({ page }) => {
  await signIn(page);
  await page.goto('/#/incidents/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('link', { name: 'All incidents' }).click();
  await expect(page.getByRole('heading', { name: /Every incident/ })).toBeVisible();
  const session = (await (await page.request.get('/api/auth/session')).json()) as {
    csrf_token: string;
  };
  expect(
    (
      await page.request.post('/api/auth/logout', {
        headers: { origin, 'x-csrf-token': session.csrf_token },
      })
    ).status(),
  ).toBe(204);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

test('supports the full mobile layout and keyboard modal dismissal', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole('button', { name: 'New incident', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await create(page, 'Mobile investigation');
  await page.getByLabel('New investigation note').fill('Captured from a small screen.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('Captured from a small screen.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath('mobile-detail.png'),
    fullPage: true,
  });
  await remove(page);
});
