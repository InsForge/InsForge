import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({ mode: 'self-hosting' as 'self-hosting' | 'cloud-hosting' }));

vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => ({ mode: hostMock.mode }),
}));

vi.mock('#features/ai/components/ModelGatewaySettingsDialog', () => ({
  ModelGatewaySettingsDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Gateway settings content</div> : null,
}));

import { AISidebar } from '#features/ai/components/AISidebar';

describe('AISidebar settings', () => {
  beforeEach(() => {
    hostMock.mode = 'self-hosting';
  });

  it('opens Model Gateway settings in self-hosting mode', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AISidebar />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Model Gateway Settings' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Gateway settings content');
  });

  it('includes the dedicated Usage page', () => {
    render(
      <MemoryRouter>
        <AISidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'href',
      '/dashboard/ai/usage'
    );
  });

  it('does not show credential settings in cloud-hosting mode', () => {
    hostMock.mode = 'cloud-hosting';
    render(
      <MemoryRouter>
        <AISidebar />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole('button', { name: 'Model Gateway Settings' })
    ).not.toBeInTheDocument();
  });
});
