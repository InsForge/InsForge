import { expect, test, type Page } from '@playwright/test';
import { mockLoggedOutApi } from './fixtures/api';

/**
 * Regression cover for #1879: the shell used to pick its dashboard from the
 * browser's own hostname, so a cloud deployment served on a custom domain got
 * the self-hosting shell. The backend already knows the answer for certain and
 * now reports it as `cloud` on `GET /api/health`.
 *
 * The Playwright baseURL is `127.0.0.1`, i.e. not `*.insforge.app` — exactly
 * the custom-domain case the issue describes. That makes these two cases the
 * before and after of the bug: with the flag the backend decides, without it
 * the old hostname guess still applies.
 */

const HEALTH_BODY = {
  status: 'ok',
  version: '1.0.0',
  service: 'Insforge OSS Backend',
  timestamp: '2026-01-01T00:00:00.000Z',
};

async function mockHealth(page: Page, body: Record<string, unknown>) {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  );
}

test('a custom-domain deployment follows the backend when it reports cloud', async ({ page }) => {
  await mockLoggedOutApi(page);
  await mockHealth(page, { ...HEALTH_BODY, cloud: true });

  await page.goto('/dashboard');

  // The self-hosting shell sends unauthenticated visitors to /dashboard/login.
  // Honouring `cloud: true` must route them into the cloud shell instead, which
  // is the whole point of the fix — on this origin the hostname says otherwise.
  await expect(page).not.toHaveURL(/\/dashboard\/login$/);
});

test('a backend that reports no cloud flag falls back to the hostname', async ({ page }) => {
  await mockLoggedOutApi(page);
  await mockHealth(page, HEALTH_BODY);

  await page.goto('/dashboard');

  // No `cloud` key at all — an older backend. The shell must behave exactly as
  // it did before this change: hostname is not `*.insforge.app`, so self-hosting.
  await expect(page).toHaveURL(/\/dashboard\/login$/);
  await expect(page.getByRole('heading', { name: 'Insforge Admin' })).toBeVisible();
});

test('an unreachable health endpoint still mounts the shell', async ({ page }) => {
  await mockLoggedOutApi(page);
  await page.route('**/api/health', (route) => route.abort());

  await page.goto('/dashboard');

  // The probe swallows its own failures and the render is in `finally`, so a
  // dead endpoint must degrade to the previous behaviour rather than leaving
  // `#root` empty — a blank page would be the worst outcome of gating the
  // first render on a network call.
  await expect(page).toHaveURL(/\/dashboard\/login$/);
  await expect(page.getByRole('heading', { name: 'Insforge Admin' })).toBeVisible();
});
