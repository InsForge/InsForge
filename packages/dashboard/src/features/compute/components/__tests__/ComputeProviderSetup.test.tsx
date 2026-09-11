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
    render(<ComputeProviderSetup provider="docker" />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/^Mount the Docker socket/i)).toBeTruthy();
    expect(screen.getByText('docker-compose.yml')).toBeTruthy();
    expect(screen.queryByText(/FLY_API_TOKEN/)).toBeNull();

    // Badged by where it goes: a shell command and a file you edit looked alike
    // without it.
    expect(screen.getAllByText('Terminal').length).toBeGreaterThan(0);
  });

  it('walks through the Fly steps, not Docker’s', () => {
    render(<ComputeProviderSetup provider="fly" onConfigure={vi.fn()} />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/^Find your org/i)).toBeTruthy();
    expect(screen.queryByText('docker-compose.yml')).toBeNull();
  });

  // The entrypoint reads the socket's group and joins it before dropping to the app
  // user, so there is no group id to look up. Asking for one was the step people got
  // wrong, and a wrong value is a silent EACCES.
  it('asks for nothing but the mount', () => {
    render(<ComputeProviderSetup provider="docker" />);

    expect(screen.queryByText(/DOCKER_GID/)).toBeNull();
    expect(screen.queryByText(/group_add/)).toBeNull();
    expect(screen.queryByText(/getent/)).toBeNull();
  });

  // The socket path is the single most useful diagnostic when a mount is missing.
  it('names the socket path it is looking for when known', () => {
    render(<ComputeProviderSetup provider="docker" socketPath="/run/user/1000/docker.sock" />);

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

  // Docker is enabled by a compose edit and configured by the same file, so there is
  // nothing to open. A button leading to a read-only tab would be furniture.
  it('gives Docker the steps and no button', () => {
    render(<ComputeProviderSetup provider="docker" />);

    expect(screen.getByText(/^Mount the Docker socket/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
  });
});
