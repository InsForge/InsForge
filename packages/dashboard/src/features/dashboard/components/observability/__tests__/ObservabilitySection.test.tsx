import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '#lib/i18n';
import { DashboardHostProvider } from '#lib/config/DashboardHostContext';
import { setDashboardBackendUrl } from '#lib/config/runtime';
import type { DashboardMode, DashboardMetricsResponse } from '#types';
import { ObservabilitySection } from '#features/dashboard/components/observability';

const CLOUD_BACKEND = 'https://demo.us-east.insforge.app';

function metricsResponse(memoryValues: number[]): DashboardMetricsResponse {
  return {
    range: '1h',
    metrics: [
      {
        metric: 'memory_usage',
        data: memoryValues.map((value, i) => ({ timestamp: 1000 + i * 60, value })),
      },
    ],
  };
}

function renderSection(mode: DashboardMode, response: DashboardMetricsResponse) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DashboardHostProvider
        value={{ mode, onRequestProjectMetrics: () => Promise.resolve(response) }}
      >
        {children}
      </DashboardHostProvider>
    </QueryClientProvider>
  );
  return render(<ObservabilitySection />, { wrapper });
}

// The advisory title is stable text around the interpolated percentage.
const advisoryText = () => screen.queryByText(/For Postgres that's normal/);

afterEach(() => {
  setDashboardBackendUrl(undefined);
});

describe('ObservabilitySection memory advisory', () => {
  it('shows the advisory with the latest reading and an Upgrade Instance CTA at 70%+', async () => {
    setDashboardBackendUrl(CLOUD_BACKEND);
    renderSection('cloud-hosting', metricsResponse([65, 66, 72]));

    await waitFor(() => expect(advisoryText()).toBeInTheDocument());
    // the banner carries the same latest sample the card headline shows
    expect(advisoryText()).toHaveTextContent('72.0%');
    expect(screen.getByRole('button', { name: 'Upgrade Instance' })).toBeInTheDocument();
  });

  it('stays silent below the 70% threshold', async () => {
    setDashboardBackendUrl(CLOUD_BACKEND);
    renderSection('cloud-hosting', metricsResponse([65, 66, 67]));

    await waitFor(() => expect(screen.getAllByText('AVG').length).toBeGreaterThan(0));
    expect(advisoryText()).toBeNull();
  });

  it('stays silent when the series is empty', async () => {
    setDashboardBackendUrl(CLOUD_BACKEND);
    renderSection('cloud-hosting', metricsResponse([]));

    await waitFor(() => expect(screen.getAllByText('AVG').length).toBeGreaterThan(0));
    expect(advisoryText()).toBeNull();
  });

  it('keeps the explanation but hides the CTA outside a cloud-hosting insforge.app project', async () => {
    // cloud-hosting mode but a non-insforge.app backend: the Compute tab the
    // CTA opens would fall back to Project Information, so no button.
    setDashboardBackendUrl('https://localhost:7130');
    renderSection('cloud-hosting', metricsResponse([70, 72, 84]));

    await waitFor(() => expect(advisoryText()).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Upgrade Instance' })).toBeNull();
  });
});
