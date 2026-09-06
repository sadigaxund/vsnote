# Critical rules — icons

Wrong/right pairs for icon usage across library components.

## Icons decorate; they never replace a name

```tsx
// ❌ WRONG — icon-only button with no accessible name
<Button variant="ghost"><Trash2 /></Button>
```

```tsx
// ✅ RIGHT — name it (visible text, aria-label only when truly icon-only)
<Button variant="ghost" aria-label="Delete row"><Trash2 /></Button>
```

Icon-only is allowed for compact toolbars and repeated row actions — but the
accessible name is mandatory, and a `Tooltip` or title should say it out loud
too.

## Size icons through the component's own axis, not className fights

```tsx
// ❌ WRONG
<Button><Trash2 className="h-7 w-7" /></Button>
```

```tsx
// ✅ RIGHT — size="lg" scales the whole control including its icon
<Button size="lg"><Trash2 /></Button>
```

Icons inside `ui/` components inherit their size from the component. If an
icon looks wrong at every size, that is an upstream issue.

## One stroke family per surface

Mixing outline icons with filled glyphs in one toolbar reads as a mistake.
Pick the set the app ships with and stay in it; consistent weight beats
per-case "best" choices.

## Decorative means hidden

```tsx
// ✅ RIGHT — an icon repeating adjacent text is aria-hidden
<Button>Save <Check className="aria-hidden" /></Button>
```

Screen readers should hear "Save", not "Save check mark".
