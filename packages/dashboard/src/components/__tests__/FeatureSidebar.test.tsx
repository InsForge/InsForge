/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeatureSidebar, type FeatureSidebarListItem } from '../FeatureSidebar';

describe('FeatureSidebar disabled items', () => {
  const items: FeatureSidebarListItem[] = [
    { id: 'a', label: 'Active Item', href: '/a' },
    { id: 'b', label: 'Disabled Item', href: '/b', disabled: true },
  ];

  it('renders disabled item without a link and with aria-disabled', () => {
    render(
      <MemoryRouter>
        <FeatureSidebar title="Test" items={items} />
      </MemoryRouter>
    );

    const enabled = screen.getByRole('link', { name: 'Active Item' });
    expect(enabled).toHaveAttribute('href', '/a');

    expect(screen.queryByRole('link', { name: 'Disabled Item' })).toBeNull();

    const disabledRow = screen.getByText('Disabled Item').closest('[aria-disabled="true"]');
    expect(disabledRow).not.toBeNull();
  });
});
