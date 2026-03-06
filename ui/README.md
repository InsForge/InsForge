# @insforge/ui

Shared React UI components, design tokens, and Tailwind preset used across InsForge apps.

## Installation

```bash
npm install @insforge/ui
```

Required peer dependencies:

```bash
npm install react react-dom tailwindcss
```

## Setup

1. Import styles once in your app entry CSS:

```css
@import '@insforge/ui/styles.css';
```

2. Add the InsForge Tailwind preset:

```js
import insforgeTailwindPreset from '@insforge/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [insforgeTailwindPreset],
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
};
```

3. Use components:

```tsx
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@insforge/ui';

export function Example() {
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update profile</DialogTitle>
        </DialogHeader>
        <Input placeholder="Name" />
        <Button className="mt-3">Save</Button>
      </DialogContent>
    </Dialog>
  );
}
```

## Exports

- Components: `Button`, `Badge`, `Checkbox`, `CopyButton`, `Dialog`, `DropdownMenu`, `Input`, `InputField`, `MenuDialog`, `Pagination`, `SearchInput`, `Select`, `Switch`, `Tabs`, `Tooltip`, `CodeBlock`
- Utilities: `cn`
- Styling entrypoints: `@insforge/ui/styles.css`, `@insforge/ui/tailwind-preset`

## Theming

- Token variables are provided in `styles.css`.
- Dark mode is enabled by adding the `dark` class on a parent element.
