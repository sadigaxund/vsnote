# Critical rules — forms

Wrong/right pairs for any form, settings page, or wizard.

## Every field is a FormField

```tsx
// ❌ WRONG — bare label + control, error text floating loose
<Label>Email</Label>
<Input value={email} onChange={(e) => setEmail(e.target.value)} />
{errors.email && <span className="text-red-500">{errors.email}</span>}
```

```tsx
// ✅ RIGHT — one component owns label, control, hint, and error wiring
import { FormField, Input } from "my-you-eye";

<FormField label="Email" error={errors.email} hint="We never share it">
  <Input value={email} onChange={(e) => setEmail(e.target.value)} />
</FormField>
```

Why: the pattern wires `aria-describedby`, `aria-invalid`, `data-invalid`,
and help/error placement automatically onto its single control child, and
marks the error text `role="alert"`. Hand-wiring them is where a11y bugs are
born. Styling hook: controls styled with `data-[invalid]:…` react to
FormField's error state without extra props.

## DialogTitle is required — hide it, never omit it

```tsx
// ❌ WRONG — no title; screen readers announce an unnamed dialog
<DialogContent><p>Are you sure?</p>…</DialogContent>
```

```tsx
// ✅ RIGHT — visually hidden title when the design shows none
<DialogContent>
  <DialogTitle className="sr-only">Delete file</DialogTitle>
  …
</DialogContent>
```

Focus is trapped and restored by the library; initial focus lands inside.
Destructive confirms keep that discipline through `ConfirmDialog`.

## A disabled submit must explain why

```tsx
// ❌ WRONG — silent dead button
<Button disabled>Save</Button>
```

```tsx
// ✅ RIGHT — say what is missing or pending
<FormField
  label="Project name"
  error={name.trim() === "" ? "Required before saving" : undefined}
>
  <Input … />
</FormField>
<Button disabled={!valid}>Save</Button>
```

## Pick the control by the job

| Job | Control |
|---|---|
| Takes effect immediately | `Switch` |
| Part of a form you submit | `Checkbox` |
| Single choice, ≤5 visible options | `RadioGroup` |
| Single choice, more options | `Select` |
| Single choice, searchable list | `Combobox` |
| Many-of choice | `MultiSelect` |

```tsx
// ❌ WRONG — a Select with 4 options and no search
<Select …>{options.map(…)}</Select>
```

```tsx
// ✅ RIGHT — RadioGroup reads faster at this size
<RadioGroup … />
```

## Validate like a summary, not a scream

One inline error per field via `FormField`; an `Alert` above the form only
for submit-level failures (network, server). Never `alert()`.

## Destructive gets danger + confirmation

```tsx
// ❌ WRONG — immediate delete on click
<Button onClick={deleteProject}>Delete project</Button>
```

```tsx
// ✅ RIGHT — danger variant opens ConfirmDialog with consequence-labeled labels
<Button variant="danger" onClick={() => setConfirming(true)}>Delete project</Button>
<ConfirmDialog
  open={confirming}
  onOpenChange={setConfirming}
  title="Delete project?"
  description="This removes the project and all its data. This cannot be undone."
  confirmLabel="Delete project"
  destructive
  onConfirm={deleteProject}
/>
```
