/**
 * Tailwind config used ONLY to compile the preview stylesheet
 * (.design-sync/gen-preview-css.mjs). Mirrors packages/dashboard/tailwind.config.js
 * — the real consumer — but scans packages/ui/src instead of the app, so the
 * compiled utilities are exactly those the @insforge/ui components reference.
 * Color names map to the design-token CSS variables (the package's preset).
 *
 * @type {import('tailwindcss').Config}
 */
const path = require('node:path');
const UI_SRC = path.resolve(__dirname, '..', 'packages', 'ui', 'src');

module.exports = {
  darkMode: ['class'],
  content: [UI_SRC + '/**/*.{ts,tsx}'],
  prefix: '',
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        'alpha-4': 'var(--alpha-4)',
        'alpha-8': 'var(--alpha-8)',
        'alpha-12': 'var(--alpha-12)',
        'alpha-16': 'var(--alpha-16)',
        foreground: 'rgb(var(--foreground))',
        'muted-foreground': 'rgb(var(--muted-foreground))',
        primary: 'rgb(var(--primary))',
        destructive: 'rgb(var(--destructive))',
        success: 'rgb(var(--success))',
        warning: 'rgb(var(--warning))',
        info: 'rgb(var(--info))',
        'semantic-0': 'rgb(var(--semantic-0))',
        'semantic-1': 'rgb(var(--semantic-1))',
        'semantic-2': 'rgb(var(--semantic-2))',
        card: 'rgb(var(--card))',
        toast: 'rgb(var(--toast))',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'toast-progress': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'toast-progress': 'toast-progress linear forwards',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
