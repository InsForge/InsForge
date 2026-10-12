export const DEFAULT_EMAIL_TEMPLATES: Record<string, { subject: string; bodyHtml: string }> = {
  'email-verification-code': {
    subject: 'Verify your email',
    bodyHtml:
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to verify your email address</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ token }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>',
  },
  'email-verification-link': {
    subject: 'Verify your email',
    bodyHtml:
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to verify your email address</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Verify Email</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>',
  },
  'reset-password-code': {
    subject: 'Reset your password',
    bodyHtml:
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to reset your password</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ token }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>',
  },
  'reset-password-link': {
    subject: 'Reset your password',
    bodyHtml:
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to reset your password</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Reset Password</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>',
  },
};
