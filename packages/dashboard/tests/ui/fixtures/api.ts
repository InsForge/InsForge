import type { Page, Route } from '@playwright/test';

const projectAdmin = {
  subject: 'local:root',
  username: 'root',
};

const selfHostingMetadata = {
  auth: {
    enabled: true,
    disableSignup: false,
    emailAuthEnabled: true,
    emailConfirmationRequired: false,
    oauthProviders: [],
    redirectUrls: [],
    smtp: null,
  },
  database: {
    tables: [
      {
        tableName: 'profiles',
        recordCount: 0,
      },
    ],
    totalSizeInGB: 0,
  },
  storage: {
    buckets: [],
    totalSizeInGB: 0,
  },
  functions: [],
  version: '2.1.5',
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function fulfillLoggedOutSession(route: Route) {
  return fulfillJson(route, 401, {
    error: 'UNAUTHORIZED',
    message: 'Authentication required',
  });
}

async function fulfillLoggedInSession(route: Route) {
  return fulfillJson(route, 200, {
    projectAdmin,
  });
}

export async function mockLoggedOutApi(page: Page) {
  await page.route('**/api/auth/sessions/current', fulfillLoggedOutSession);
}

export async function mockSelfHostingDashboardApi(page: Page) {
  let isLoggedIn = false;

  await page.route('**/api/auth/sessions/current', (route) => {
    if (!isLoggedIn) {
      return fulfillLoggedOutSession(route);
    }

    return fulfillLoggedInSession(route);
  });

  await page.route('https://api.github.com/repos/InsForge/InsForge', (route) =>
    fulfillJson(route, 200, {
      stargazers_count: 0,
    })
  );

  await page.route('**/api/auth/admin/sessions', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    isLoggedIn = true;
    return fulfillJson(route, 200, {
      projectAdmin,
      accessToken: 'test-access-token',
      csrfToken: 'test-csrf-token',
    });
  });

  await page.route('**/api/metadata/api-key', (route) =>
    fulfillJson(route, 200, {
      apiKey: 'ik_test_dashboard_ui_smoke_key',
    })
  );

  await page.route('**/api/metadata/project-id', (route) =>
    fulfillJson(route, 200, {
      projectId: 'local-dashboard-ui-test',
    })
  );

  await page.route('**/api/metadata', (route) => fulfillJson(route, 200, selfHostingMetadata));

  await page.route('**/api/auth/users?*', (route) =>
    fulfillJson(route, 200, {
      data: [],
      pagination: {
        offset: 0,
        limit: 50,
        total: 0,
      },
    })
  );

  await page.route('**/api/usage/mcp?*', (route) =>
    fulfillJson(route, 200, {
      records: [],
    })
  );
}
