import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComputeProviderSetup } from '#features/compute/components/ComputeProviderSetup';

// No query client or toast provider: the panel is a guide and owns no inputs, which
// is the point of handing the values to the settings dialog.
describe('ComputeProviderSetup', () => {
  // Per provider, because the steps genuinely differ: Docker is a compose edit,
  // Fly is two credentials. One generic screen would bury whichever the operator
  // actually wants.
  it('walks through the Docker steps, not Fly’s', () => {
    render(<ComputeProviderSetup provider="docker" onConfigure={vi.fn()} />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/^Uncomment these lines/i)).toBeTruthy();
    expect(screen.getByText(/^Put your host/i)).toBeTruthy();
    expect(screen.getByText('docker-compose.yml')).toBeTruthy();
    expect(screen.queryByText(/FLY_API_TOKEN/)).toBeNull();
  });

  it('walks through the Fly steps, not Docker’s', () => {
    render(<ComputeProviderSetup provider="fly" onConfigure={vi.fn()} />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/^Find your org/i)).toBeTruthy();
    expect(screen.queryByText('docker-compose.yml')).toBeNull();
  });

  // The socket path is the single most useful diagnostic when a mount is missing.
  it('names the socket path it is looking for when known', () => {
    render(
      <ComputeProviderSetup
        provider="docker"
        socketPath="/run/user/1000/docker.sock"
        onConfigure={vi.fn()}
      />
    );

    expect(screen.getByText(/\/run\/user\/1000\/docker\.sock/)).toBeTruthy();
  });

  // Values are entered in one place. A second form here would be a second thing to
  // keep in step with the dialog, so the panel hands over instead.
  it('sends the operator to the settings dialog rather than taking input', async () => {
    const onConfigure = vi.fn();
    render(<ComputeProviderSetup provider="fly" onConfigure={onConfigure} />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Enter Fly\.io credentials/i }));
    expect(onConfigure).toHaveBeenCalledOnce();
  });

  it('offers Docker its settings too, for a socket that is not at the default path', async () => {
    const onConfigure = vi.fn();
    render(<ComputeProviderSetup provider="docker" onConfigure={onConfigure} />);

    await userEvent.click(screen.getByRole('button', { name: /Open Docker settings/i }));
    expect(onConfigure).toHaveBeenCalledOnce();
  });
});
