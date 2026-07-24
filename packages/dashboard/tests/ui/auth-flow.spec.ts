import { expect, test } from '@playwright/test';
import { mockLoggedOutApi, mockSelfHostingDashboardApi } from './fixtures/api';

test('signs in with mocked self-hosting admin credentials', async ({ page }) => {
  await mockSelfHostingDashboardApi(page);

  await page.goto('/dashboard/login');
  await expect(page.getByRole('heading', { name: 'Insforge Admin' })).toBeVisible();

  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[type="password"]').fill('test-admin-password-for-ci');
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/sessions') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await loginResponse).status()).toBe(200);

  await expect(page).toHaveURL(/\/dashboard$/);
});

test('lazy-loads a feature section on navigation after signing in', async ({ page }) => {
  await mockSelfHostingDashboardApi(page);

  await page.goto('/dashboard/login');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[type="password"]').fill('test-admin-password-for-ci');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Navigating to another section must resolve that section's lazy route chunk
  // through Suspense and render the page — not the loading fallback or the
  // chunk error boundary. This guards route-level code splitting in AppRoutes.
  await page.getByRole('link', { name: 'Authentication' }).click();
  await expect(page).toHaveURL(/\/dashboard\/authentication\/users$/);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
});

test('redirects unauthenticated dashboard visitors to the self-hosting login page', async ({
  page,
}) => {
  await mockLoggedOutApi(page);

  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/dashboard\/login$/);
  await expect(page.getByRole('heading', { name: 'Insforge Admin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
