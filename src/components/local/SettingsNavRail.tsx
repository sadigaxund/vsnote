/**
 * SettingsNavRail — a vertical (or, below the 900px breakpoint, horizontal)
 * scroll-spy table of contents for the Settings view.
 *
 * `my-you-eye` has no vertical NavList / SideNav / TOC primitive (checked
 * `skills/my-you-eye/components.json`: `Tabs` is the only navigation-group
 * component, and its only variants are `filing` / `pills` / `underline` —
 * none of them is a plain, unfilled "current row" look with a leading
 * accent bar). `SettingsView.tsx` used to force `Tabs` (`variant="pills"`,
 * `role="tablist"`/`role="tab"`) into this job even though the rail never
 * behaved like a tab switcher — clicking a row smooth-scrolls to a section
 * that is ALREADY mounted, and every row's "current" state tracks scroll
 * position, not a click. Filed as a design-health P1
 * (`.impeccable/critique/…settingsview…`, "rail semantics contradict its
 * look: pills + aria-selected over a continuous-scroll TOC") and reported
 * upstream as a missing-component gap, sadigaxund/my-you-eye#41, per
 * CLAUDE.md rule 2's "missing component protocol" (do not re-file a
 * duplicate issue).
 *
 * This local component replaces `Tabs`/`TabsList`/`TabsTrigger` with plain
 * semantic markup that matches what the rail actually is:
 *   - `<nav role="navigation">` (the `role` is redundant on a `<nav>` but
 *     is set explicitly since this replaces a `role="tablist"` the library
 *     rendered before — a reader relying on the attribute, not the tag,
 *     should still see the right value).
 *   - one `<ul role="list">` per group (`role="list"` counters Safari/
 *     VoiceOver dropping the implicit list role once `list-style: none`
 *     is applied), separated by a `my-you-eye` `Separator` — two dividers
 *     for the three groups this view passes, never a group label.
 *   - `aria-current="true"` on the current row instead of `aria-selected`
 *     — a TOC's current entry, not a tablist's selected tab.
 * Visuals: plain text rows (icon + label), no filled pill background,
 * muted text for inactive rows, a hover surface, and a 2px accent bar on
 * the left edge (top edge when the rail reflows horizontal) of the current
 * row. All colors/spacing come from the existing `--color-*` tokens and
 * the 4/8 grid (`index.css`'s `.settings-nav-rail__*` rules) — no new
 * hard-coded colors.
 *
 * Keyboard: roving tabindex, matching the up/down (vertical) or left/right
 * (horizontal) arrow-key nav Radix's `Tabs.Root` gave the previous
 * implementation for free — Home/End jump to the first/last row, and only
 * the current row sits in the natural Tab order (`tabIndex 0`); every
 * other row is reachable by arrow key (`tabIndex -1`, focused via `.focus()`)
 * so Tab doesn't have to walk all 8 rows to leave the rail. A row activates
 * (calls `onSelect`) on click, Enter or Space — all three are the browser's
 * own `<button>` behavior, not code this component has to reimplement.
 */
import { Fragment, useRef } from "react";
import { Separator } from "my-you-eye";

export interface SettingsNavRailItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface SettingsNavRailProps {
  /** Rows, pre-split into the groups two dividers should separate. */
  groups: SettingsNavRailItem[][];
  activeId: string;
  onSelect: (id: string) => void;
  orientation: "vertical" | "horizontal";
  "aria-label": string;
}

export function SettingsNavRail({ groups, activeId, onSelect, orientation, ...rest }: SettingsNavRailProps) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const flatIds = groups.flat().map((i) => i.id);

  const focusByOffset = (fromId: string, offset: number) => {
    const idx = flatIds.indexOf(fromId);
    if (idx === -1) return;
    const nextIdx = (idx + offset + flatIds.length) % flatIds.length;
    itemRefs.current.get(flatIds[nextIdx])?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const backward = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    if (e.key === forward) {
      e.preventDefault();
      focusByOffset(id, 1);
    } else if (e.key === backward) {
      e.preventDefault();
      focusByOffset(id, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current.get(flatIds[0])?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current.get(flatIds[flatIds.length - 1])?.focus();
    }
  };

  return (
    <nav className="settings-nav-rail" role="navigation" aria-label={rest["aria-label"]}>
      {groups.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 && (
            <Separator
              className="settings-nav-rail__divider"
              orientation={orientation === "vertical" ? "horizontal" : "vertical"}
            />
          )}
          <ul className="settings-nav-rail__list" role="list">
            {group.map((item) => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) itemRefs.current.set(item.id, el);
                      else itemRefs.current.delete(item.id);
                    }}
                    className="settings-nav-rail__item"
                    data-testid={`settings-nav-${item.id}`}
                    data-active={active ? "true" : undefined}
                    aria-current={active ? "true" : undefined}
                    tabIndex={active ? 0 : -1}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(e) => handleKeyDown(e, item.id)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}
