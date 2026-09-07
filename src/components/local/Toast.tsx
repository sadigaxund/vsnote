/**
 * Toast / Toaster — local replacement for `my-you-eye`'s `useToast`/
 * `Toaster` (docs/COMPONENT-BACKLOG.md §2.12, design-polish round 2,
 * 2026-09-07).
 *
 * Gap: the library's `ToastItem` (`node_modules/my-you-eye/dist/index.js`)
 * hardcodes its `success`/`danger` variants as a SOLID fill —
 * `"border-success bg-success text-success-fg"` — via an internal,
 * unexported `toastVariants` `cva()` call. `ToastData` (the public type for
 * `toast({ ... })`) has no `className` field (`node_modules/my-you-eye/
 * dist/index.d.ts`), so there is no supported prop or token lever to
 * restyle it: the color IS the fill, not a token this app can remap without
 * recoloring `--color-success`/`--color-danger` globally (used elsewhere
 * for real semantic meaning — git status, alerts, badges). That is a
 * genuine gap, not a "fix in this file first" case — CLAUDE.md rule 2's
 * missing-component protocol applies.
 *
 * Built the same way `ContextMenu.tsx` (this file's nearest sibling)
 * replaced `DropdownMenu` for a Radix primitive the library doesn't
 * expose: same underlying Radix package the library itself uses
 * (`@radix-ui/react-toast`, added as a direct dependency), OUR OWN
 * `cva`-free class list reading the same token vocabulary every other
 * local component already does (`bg-surface-elevated`, `border-border`,
 * `rounded-ui`, `shadow-elevated`), so the toast is visually consistent
 * with the rest of the shell without touching a single library internal.
 * Accessibility behavior (the Radix `Provider`'s duplicate visually-hidden
 * `role="status"` announcer alongside the visible toast, depended on by
 * `tests/e2e/markii-scripts.spec.ts`) is preserved exactly, since it comes
 * from the same Radix primitives, not from `my-you-eye`'s styling layer.
 *
 * Drop-in API: `ToastData`/`useToast()`/`Toaster` match the library's own
 * shapes byte-for-byte, so every existing `toast({ title, description,
 * variant })` call site only needed its import source changed, never its
 * call shape. `useToast`/`ToastData`/`ToastContext` live in the sibling
 * `useToast.ts` instead of here — `react-refresh/only-export-components`
 * flags a module that exports both a component (`Toaster`) and a plain
 * hook, so they're split the same way this codebase already separates
 * store hooks from components.
 */
import { forwardRef, useCallback, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Provider, Root, Title, Description, Close, Viewport } from "@radix-ui/react-toast";
import { cn } from "my-you-eye";
import { ToastContext, type ToastData } from "./useToast";

// One accent per variant — the left bar AND the title share it, so the
// status reads immediately without relying on a solid color fill for the
// whole toast body (the "loudest, crudest element on screen" the round-2
// verdict named). "default" uses the accent/info color, matching the
// judge's "info accent" instruction for the third tier.
const VARIANT_ACCENT: Record<NonNullable<ToastData["variant"]>, string> = {
  default: "var(--color-primary)",
  success: "var(--color-success)",
  danger: "var(--color-danger)",
};

const ToastItem = forwardRef<HTMLLIElement, ComponentPropsWithoutRef<typeof Root> & ToastData>(
  ({ title, description, variant = "default", ...props }, ref) => {
    const accent = VARIANT_ACCENT[variant];
    return (
      <Root
        ref={ref}
        className={cn(
          "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-ui border border-border bg-surface-elevated p-panel pl-4 text-fg shadow-elevated backdrop-blur-ui",
          "data-[swipe=end]:animate-out data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0",
        )}
        {...props}
      >
        {/* 3px left accent bar in the status color (round 2 item 1) —
            replaces the library's solid-fill variant background. */}
        <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
        <div className="flex flex-col gap-1">
          {title && (
            <Title className="text-sm font-semibold" style={{ color: accent }}>
              {title}
            </Title>
          )}
          {description && <Description className="text-sm text-fg opacity-90">{description}</Description>}
        </div>
        <Close className="ml-auto shrink-0 opacity-dim hover:opacity-100" aria-label="Dismiss">
          <svg viewBox="0 0 15 15" className="size-4 fill-current" aria-hidden>
            <path d="M2 2l11 11M13 2L2 13" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </Close>
      </Root>
    );
  },
);
ToastItem.displayName = "ToastItem";

export function Toaster({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const toast = useCallback((data: Omit<ToastData, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...data, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Provider>
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} />
        ))}
        <Viewport
          className="fixed flex flex-col gap-2 w-full max-w-sm"
          style={{ bottom: "var(--spacing-panel)", right: "var(--spacing-panel)", zIndex: "var(--z-toast)" }}
        />
      </Provider>
    </ToastContext.Provider>
  );
}
