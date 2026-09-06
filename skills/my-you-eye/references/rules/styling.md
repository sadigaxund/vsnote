# Critical rules — styling

Wrong/right pairs. When a pair matches your situation, do the right one —
no exceptions without a written reason.

## Never hand-roll a styled native element

```tsx
// ❌ WRONG — a bespoke button
<button
  className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
  onClick={save}
>
  Save
</button>
```

```tsx
// ✅ RIGHT — the library component, token-driven variants only
import { Button } from "my-you-eye";

<Button variant="primary" onClick={save}>Save</Button>
```

Why: the hand-rolled button misses focus-visible rings, disabled handling,
loading state, theme switching, and contrast guarantees the real component
already has.

## Never restyle through className

```tsx
// ❌ WRONG — piling utilities to fight the default look
<Button className="rounded-full bg-purple-600 shadow-lg uppercase">Go</Button>
```

```tsx
// ✅ RIGHT — pick a variant; if none fits, request one upstream
<Button variant="primary" size="lg">Go</Button>
```

More than ~3 utility classes on a `ui/` component means you want a variant,
a different component, or a token change — not a local override. `className`
is for one-off layout (width, margin, alignment) only.

## Never hardcode a color or pixel value

```tsx
// ❌ WRONG
<div className="bg-[#3b82f6] text-[13px] rounded-[10px]" />
```

```tsx
// ✅ RIGHT — semantic tokens mapped by the theme system
<div className="bg-primary text-sm rounded-ui" />
```

Arbitrary values break every theme except the one you eyeballed them in.

## Never override dark mode per element

```tsx
// ❌ WRONG — manual dark: forks of the palette
<Card className="dark:bg-neutral-900 dark:border-neutral-800" />
```

```tsx
// ✅ RIGHT — set data-theme / .dark once at <html>; components follow
document.documentElement.classList.toggle("dark");
```

## Never stack z-index hacks

```tsx
// ❌ WRONG
<Dialog className="z-[9999]" />
```

Overlay stacking is owned by the library's `--z-*` token scale. If overlays
stack wrong, that is a bug to report upstream — not something to out-shout.
