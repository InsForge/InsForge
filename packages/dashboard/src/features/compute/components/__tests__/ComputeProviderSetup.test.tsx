import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComputeProviderSetup } from '#features/compute/components/ComputeProviderSetup';

describe('ComputeProviderSetup', () => {
  // Per provider, because the steps genuinely differ: Docker is a compose edit,
  // Fly is two credentials. One generic screen would bury whichever the operator
  // actually wants.
  it('walks through the Docker steps, not Fly’s', () => {
    render(<ComputeProviderSetup provider="docker" />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/Mount the Docker socket/i)).toBeTruthy();
    expect(screen.getByText(/^Set your host/i)).toBeTruthy();
    expect(screen.getByText('docker-compose.yml')).toBeTruthy();
    expect(screen.queryByText(/FLY_API_TOKEN/)).toBeNull();
  });

  it('walks through the Fly steps, not Docker’s', () => {
    render(<ComputeProviderSetup provider="fly" />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/Create a token/i)).toBeTruthy();
    expect(screen.queryByText('docker-compose.yml')).toBeNull();
  });

  // The socket path is the single most useful diagnostic when a mount is missing.
  it('names the socket path it is looking for when known', () => {
    render(<ComputeProviderSetup provider="docker" socketPath="/run/user/1000/docker.sock" />);

    expect(screen.getByText(/\/run\/user\/1000\/docker\.sock/)).toBeTruthy();
  });
});
