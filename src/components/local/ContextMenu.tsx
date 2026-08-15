/**
 * ContextMenu — right-click menus (file tree rows this phase; tabs/editor
 * later). Logged in docs/COMPONENT-BACKLOG.md ("ContextMenu", status
 * `built-locally`, used in `src/components/local/ExplorerTree.tsx`).
 *
 * The library's `DropdownMenu` is click-trigger only (its `Trigger` wraps
 * `@radix-ui/react-dropdown-menu`, which has no pointer-position open API —
 * confirmed via `node_modules/my-you-eye/dist/index.d.ts`, `DropdownMenu`
 * re-exports Radix's `Root`/`Trigger` unmodified). Radix ships a dedicated
 * `@radix-ui/react-context-menu` primitive built exactly for this (opens at
 * the pointer on right-click / long-press, same a11y model as its
 * `DropdownMenu`) — added as a dependency and styled with the *identical*
 * Tailwind classes `my-you-eye`'s own `DropdownMenuContent`/`Item`/
 * `Separator` use (read from `node_modules/my-you-eye/dist/chunk-*.js`), so
 * a context menu is visually indistinguishable from the library's own
 * dropdown, not a fork of it.
 */
import { forwardRef } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "my-you-eye";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "backdrop-blur-ui z-[var(--z-overlay)] min-w-[10rem] overflow-hidden rounded-ui border border-border bg-bg p-1 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuItem = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-ui-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      destructive ? "text-danger focus:bg-danger/10" : "text-fg focus:bg-secondary focus:text-secondary-fg",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
