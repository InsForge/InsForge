/** @type {import('tailwindcss').Config} */
const tailwindPreset = {
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
        'semantic-0': 'rgb(var(--semantic-0))',
        'semantic-1': 'rgb(var(--semantic-1))',
        'semantic-2': 'rgb(var(--semantic-2))',
        card: 'rgb(var(--card))',
        toast: 'rgb(var(--toast))',
      },
    },
  },
};

export default tailwindPreset;
