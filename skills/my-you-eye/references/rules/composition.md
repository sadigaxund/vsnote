# Critical rules — composition

Wrong/right pairs for component API shape and app structure.

## Explicit variants beat boolean-prop sprawl

```tsx
// ❌ WRONG — booleans multiply and fight
<Badge isPrimary isLarge isPill isWarning />
```

```tsx
// ✅ RIGHT — closed axes with allowed values from the manifest
<Badge variant="warning" size="lg" />
```

If two booleans can combine into a nonsense state, they should have been one
variant axis.

## Children over render props; compound parts over prop objects

```tsx
// ❌ WRONG — a mega-prop API re-inventing JSX
<Card header={…} body={…} footerActions={[{label, onClick}]} />
```

```tsx
// ✅ RIGHT — the shipped compound parts
<Card>
  <CardHeader>…</CardHeader>
  <CardContent>…</CardContent>
  <CardFooter>…</CardFooter>
</Card>
```

## Check installed + local components before building anything

Before writing any new component: (1) search `components.json`, (2) check the
consuming project's local-component inventory if it keeps one.

```tsx
// ❌ WRONG — rebuilding a context menu from scratch in the app
<div className="absolute …menu styles…" onMouseLeave={close}>…</div>
```

```tsx
// ✅ RIGHT — library primitive, or a documented local gap-filler
import { DropdownMenu } from "my-you-eye";
```

If the component genuinely does not exist anywhere, it belongs upstream:
build it in the library repo following its AGENTS.md — never inline a new
styled primitive in the consuming app. Until that lands, a *local*
composition of existing library parts is acceptable; record it in the
project's backlog doc so it can be promoted later.

## Local gap-fillers follow the library's own API law

A temporary local component must look like it belongs in the library:
forwarded ref, spread rest props, CVA variants with `variant`/`size` axes,
`cn()` merge with `className` last, token-mapped classes only. This keeps
future promotion upstream trivial.

## State decoupling — context exposes intent, not implementation

```tsx
// ❌ WRONG — leaking store internals through context
<TabsContext value={{ zustandStore, dispatch }} />
```

```tsx
// ✅ RIGHT — {state, actions} shaped for the consumer
<TabsContext value={{ activeTab, selectTab }} />
```

## One primary action per view

Every screen has exactly one `variant="primary"` action; everything else is
`secondary`/`ghost`. Two primaries compete; zero means the view has no point.
