import { expect, test } from '@playwright/test';
import { mockLoggedOutApi, mockSelfHostingDashboardApi } from './fixtures/api';

test('signs in with mocked self-hosting admin credentials', async ({ page }) => {
  await mockSelfHostingDashboardApi(page);

  await page.goto('/dashboard/login');
  await expect(page.getByRole('heading', { name: 'Insforge Admin' })).toBeVisible();

  await page.locator('input[type="email"]').fill('admin@example.com');
  await page.locator('input[type="password"]').fill('test-admin-password-for-ci');
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/sessions') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await loginResponse).status()).toBe(200);

  await expect(page).toHaveURL(/\/dashboard$/);
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
