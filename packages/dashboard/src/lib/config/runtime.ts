let dashboardBackendUrl = '';

function normalizeUrl(url?: string) {
  return url?.replace(/\/$/, '') ?? '';
}

export function setDashboardBackendUrl(url?: string) {
  dashboardBackendUrl = normalizeUrl(url);
}

export function getDashboardBackendUrl() {
  if (dashboardBackendUrl) {
    return dashboardBackendUrl;
  }

  if (typeof window !== 'undefined') {
    return normalizeUrl(window.location.origin);
  }

  return '';
}

export function getDashboardApiBaseUrl() {
  return dashboardBackendUrl ? `${dashboardBackendUrl}/api` : '/api';
}
