import { describe, expect, it } from 'vitest';
import { maskReplayAttribute } from '#lib/analytics/replay-privacy';

describe('maskReplayAttribute', () => {
  it.each([
    ['title', 'invoices/2026/patient-jane-doe-mri.pdf'],
    ['alt', 'Jane Doe'],
    ['placeholder', 'jane.doe@example.com'],
    ['aria-label', 'Delete jane.doe@example.com'],
    ['href', 'https://example.test/users/jane'],
    ['src', 'https://cdn.example.test/avatars/jane.png'],
    ['srcdoc', '<p>Dear Jane Doe</p>'],
    ['value', '555-0100'],
    ['data-row-value', 'jane.doe@example.com'],
    ['rr_src', 'blob:https://example.test/preview'],
    ['id', 'patient_email-source'],
    ['for', 'patients-diagnosis'],
    ['aria-controls', 'sub_1PqRstUvWxYz'],
    ['aria-labelledby', 'patients-diagnosis-label'],
    ['aria-describedby', 'sub_1PqRstUvWxYz-details'],
    ['some-future-attribute', 'customer data'],
  ])('masks %s', (name, value) => {
    const masked = maskReplayAttribute(name, value);

    expect(masked).not.toContain(value);
    expect(masked).toBe('*'.repeat(value.length));
  });

  it.each([
    ['class', 'truncate text-[13px] leading-[18px]'],
    ['style', 'width: 120px'],
    ['role', 'gridcell'],
    ['data-state', 'open'],
    ['aria-expanded', 'true'],
    ['aria-rowindex', '4'],
    ['d', 'M21 12a9 9 0 1 1-6.219-8.56'],
    ['viewBox', '0 0 24 24'],
    ['rr_width', '320px'],
  ])('keeps layout attribute %s', (name, value) => {
    expect(maskReplayAttribute(name, value)).toBe(value);
  });

  it('leaves empty values alone', () => {
    expect(maskReplayAttribute('title', '')).toBe('');
  });
});
