import { useEffect } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useDashboardHost } from '../lib/config/DashboardHostContext';

function RouteChangeNotifier() {
  const location = useLocation();
  const host = useDashboardHost();

  useEffect(() => {
    host.onRouteChange?.({
      path: `${location.pathname}${location.search}${location.hash}`,
    });
  }, [host, location.hash, location.pathname, location.search]);

  return null;
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="if-dashboard__placeholder">
      <p className="if-dashboard__eyebrow">Shared Dashboard Package</p>
      <h1 className="if-dashboard__title">{title}</h1>
      <p className="if-dashboard__description">{description}</p>
    </section>
  );
}

export function DashboardRouter() {
  const host = useDashboardHost();

  return (
    <MemoryRouter initialEntries={[host.initialPath || '/dashboard']}>
      <RouteChangeNotifier />
      <Routes>
        <Route
          path="/dashboard"
          element={
            <PlaceholderPage
              title="Dashboard Home"
              description="This package now owns the shared dashboard app shell. Feature modules from the legacy frontend will move here incrementally."
            />
          }
        />
        <Route
          path="/dashboard/authentication/*"
          element={
            <PlaceholderPage
              title="Authentication"
              description="Authentication pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route
          path="/dashboard/database/*"
          element={
            <PlaceholderPage
              title="Database"
              description="Database pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route
          path="/dashboard/storage/*"
          element={
            <PlaceholderPage
              title="Storage"
              description="Storage pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route
          path="/dashboard/functions/*"
          element={
            <PlaceholderPage
              title="Functions"
              description="Functions pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route
          path="/dashboard/ai/*"
          element={
            <PlaceholderPage
              title="AI"
              description="AI pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route
          path="/dashboard/logs/*"
          element={
            <PlaceholderPage
              title="Logs"
              description="Logs pages will migrate from the legacy frontend into the shared package."
            />
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </MemoryRouter>
  );
}
