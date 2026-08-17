/**
 * DropdownSubmenu — a nested submenu for `my-you-eye`'s `DropdownMenu`
 * (item 38's three-dot overflow menu: Format/Insert are submenus of it).
 * Logged in docs/COMPONENT-BACKLOG.md ("DropdownSubmenu", status
 * `built-locally`, used in `src/components/local/OverflowMenu.tsx`).
 *
 * The library exports `DropdownMenu`/`DropdownMenuTrigger`/
 * `DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuLabel`/
 * `DropdownMenuSeparator` (confirmed via `node_modules/my-you-eye/dist/
 * index.d.ts`) but no `Sub`/`SubTrigger`/`SubContent` — it re-exports only
 * Radix's `Root`/`Trigger` for `DropdownMenu` itself. Same gap, same fix as
 * `local/ContextMenu.tsx`: `@radix-ui/react-dropdown-menu` (already present
 * in `node_modules` as an indirect dependency of `my-you-eye`, promoted to a
 * direct one in package.json since this file imports its `Sub`/`SubTrigger`/
 * `SubContent` parts by name) already ships the exact primitive — no need to
 * hand-roll positioning/focus/keyboard nav for a nested menu. Styled with
 * the *identical* Tailwind classes `my-you-eye`'s own
 * `DropdownMenuContent`/`DropdownMenuItem` use internally (read from
 * `node_modules/my-you-eye/dist/index.js`'s `DropdownMenuContent`/
 * `DropdownMenuItem` source, lines ~1392-1421), so a submenu is visually
 * indistinguishable from the library's own top-level dropdown, not a fork
 * of it — `SubTrigger` is `DropdownMenuItem`'s exact class list plus a
 * trailing chevron and the `data-[state=open]` highlight Radix's `SubTrigger`
 * already exposes as a data attribute.
 */
import { forwardRef } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";
import { cn } from "my-you-eye";

export const DropdownSubmenu = DropdownMenuPrimitive.Sub;

export const DropdownSubmenuTrigger = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center justify-between rounded-ui-sm px-2 py-1.5 text-sm outline-none",
      "text-fg focus:bg-secondary focus:text-secondary-fg data-[state=open]:bg-secondary data-[state=open]:text-secondary-fg",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight size={14} aria-hidden />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownSubmenuTrigger.displayName = "DropdownSubmenuTrigger";

export const DropdownSubmenuContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      sideOffset={2}
      alignOffset={-4}
      className={cn(
        "backdrop-blur-ui z-[var(--z-overlay)] min-w-[8rem] overflow-hidden rounded-ui border border-border bg-bg p-1 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownSubmenuContent.displayName = "DropdownSubmenuContent";
