import { test, expect } from '@playwright/test';

const adminRoutes = [
  '/admin',
  '/admin/quick-pick',
  '/admin/channels',
  '/admin/movies',
  '/admin/series',
  '/admin/users',
  '/admin/devices',
  '/admin/plans',
  '/admin/codes',
  '/admin/import',
  '/admin/m3u-sources',
  '/admin/xtream-sources',
  '/admin/sources',
  '/admin/epg',
  '/admin/versions',
  '/admin/stats',
  '/admin/activity',
  '/admin/scheduler',
  '/admin/settings',
];

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/DZ HOOF IPTV/i);
});

test('login page loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
});

test('health endpoint responds', async ({ request }) => {
  const response = await request.get('http://localhost:3000/health');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBeDefined();
});

test('all admin routes render after admin login', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#username').fill(process.env.E2E_ADMIN_USERNAME || 'superadmin');
  await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD || 'ChangeMeNow123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin(?:$|\/)/);

  for (const route of adminRoutes) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `${route} returned an unexpected status`).toBeLessThan(500);
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('main')).toBeVisible();
  }
});
