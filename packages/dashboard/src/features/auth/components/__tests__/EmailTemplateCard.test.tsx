import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '#lib/i18n';
import { EmailTemplateCard } from '#features/auth/components/EmailTemplateCard';

const REQUEST_OTP_TEMPLATE = {
  id: '11111111-1111-4111-8111-111111111111',
  templateType: 'request-otp',
  subject: '{{ token }} is your verification code',
  bodyHtml: '<p>Your sign-in code is {{ token }}</p>',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('EmailTemplateCard request-otp support', () => {
  it('shows the sign-in template and its token variable', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <EmailTemplateCard
        templates={[REQUEST_OTP_TEMPLATE]}
        isLoading={false}
        isUpdating={false}
        onSave={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Email OTP Sign-In/i }));

    expect(screen.getByText('{{ token }}')).toBeInTheDocument();
    expect(container).toHaveTextContent('6-digit sign-in code');
  });
});
