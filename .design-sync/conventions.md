# Building with @insforge/ui

A React + Tailwind-v4 component library. **The components are fully styled out of the
box — compose them directly.** Style your own layout with the design **tokens** below
(CSS variables), not with new Tailwind utility classes: the shipped stylesheet contains
only the utilities the library components themselves use, so a novel class like
`bg-slate-200` won't resolve. Tokens always resolve.

## Setup

- **Dark mode**: every token has a light value and a `.dark` value. Put `class="dark"`
  on an ancestor to switch the whole tree; default (no class) is light. Don't hardcode
  hex — read the token so light/dark both work.
- **Tooltip** needs a `TooltipProvider` ancestor (wrap once near the root). No other
  global provider is required; Dialog/Select/DropdownMenu/MenuDialog work standalone.

## Design tokens (the styling primitive)

Use via `var(--x)`. Color tokens marked ⟨rgb⟩ are RGB triplets — wrap them:
`rgb(var(--foreground))` (or `rgb(var(--primary) / 0.5)` for alpha).

- **Surfaces**: `--page` (app bg) ⟨rgb⟩, `--card` ⟨rgb⟩, `--toast` ⟨rgb⟩ (popovers/menus),
  `--semantic-0`…`--semantic-6` ⟨rgb⟩ (neutral elevation scale, 0 = base).
- **Text**: `--foreground` ⟨rgb⟩ (default), `--muted-foreground` ⟨rgb⟩ (secondary),
  `--inverse` ⟨rgb⟩ (on dark/primary fills), `--disabled` ⟨rgb⟩.
- **Brand/status**: `--primary` ⟨rgb⟩ (emerald), `--destructive` ⟨rgb⟩, `--success` ⟨rgb⟩,
  `--warning` ⟨rgb⟩, `--info` ⟨rgb⟩.
- **Lines/overlays**: `--border` (use directly, already a color), `--alpha-4/8/12/16`
  (hairlines & hover fills, tone-aware), `--alpha-inverse-4/8/12/16`.
- Brand font is **Inter** (loaded globally). `font-family: var(--insforge-font)`.

Example layout glue: `<div style={{ background: 'rgb(var(--page))', color: 'rgb(var(--foreground))', padding: 24 }}>`.

## Component styling idiom: props, not classes

Components carry their own styling; you pick the look through **props** (and `className`
is passed through for spacing tweaks). Key vocabularies:

- **Button** — `variant`: `primary` (default) · `secondary` · `outline` · `ghost` ·
  `destructive`; `size`: `sm` · `default` · `lg` · `icon-sm` · `icon` · `icon-lg`.
  Put a `lucide-react` icon as a child; it auto-sizes.
- **Badge** — `variant`: `default` · `rounded` · `number` (red counter pill).
- **Switch** — `size`: `default` · `sm`. **Checkbox/Switch** are controlled
  (`checked` + `onCheckedChange`); Checkbox also accepts `checked="indeterminate"`.
- **InputField** — labeled input with optional leading icon / trailing dropdown / helper
  tip / error, each gated by a `show*` flag that **defaults true**. For a plain field set
  `showIcon={false} showDropdown={false} showTip={false}`; pass `error="…"` for the error state.
  Use plain **Input** for the bare control, **SearchInput** for search.
- **Compounds** (import the parts, all from `@insforge/ui`): **Dialog** = `Dialog` +
  `DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogBody`/`DialogFooter`/
  `DialogMessage`; **Select** = `Select`+`SelectTrigger`+`SelectValue`+`SelectContent`+`SelectItem`;
  **DropdownMenu**, **MenuDialog** (settings-style modal with `MenuDialogSideNav`/`MenuDialogMain`),
  **Tabs** (`Tabs`+`Tab` — strip only; render panel content as a sibling). **ConfirmDialog**
  is a one-shot confirm (`title`/`description`/`destructive`/`onConfirm`).

## Where the truth lives

Read the bound `styles.css` (and its `_ds_bundle.css` import) for the exact tokens, and
each component's `<Name>.prompt.md` / `<Name>.d.ts` for its full prop contract before styling.

## Idiomatic example

```tsx
import { Button, Badge } from '@insforge/ui';

function ProjectRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16,
                  background: 'rgb(var(--card))', border: '1px solid var(--border)',
                  borderRadius: 6 }}>
      <span style={{ color: 'rgb(var(--foreground))', fontWeight: 500 }}>insforge-prod</span>
      <Badge variant="rounded">Production</Badge>
      <Button size="sm" style={{ marginLeft: 'auto' }}>Open</Button>
    </div>
  );
}
```
