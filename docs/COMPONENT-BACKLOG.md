# my-you-eye — component backlog

Components this project needed that the library does not (yet) provide. Each was built
locally in `src/components/local/` following library conventions (tokens, variants,
a11y) and is a candidate to upstream into `my-you-eye`.

**Protocol:** whenever you build something in `src/components/local/`, add/update a row
here in the same commit. Status: `planned` → `built-locally` → `upstreamed`.

| Component | Group | Why the library gap matters | Suggested API sketch | Status |
|---|---|---|---|---|
| `ContextMenu` | overlay | Right-click menus (file tree, tabs, editor). `DropdownMenu` is click-trigger only; no positioning at pointer. | Radix ContextMenu-style parts: `ContextMenu, Trigger, Content, Item, Separator, Sub` | planned |
| `EditorTabBar` / `Tab` | navigation | VSCode-style document tabs: per-tab icon, close ×, dirty dot, preview (italic) state, git-color tint, overflow scroll + menu. `Tabs` is content-switching nav, not a document strip. | `<EditorTabBar tabs={[{id, icon, label, dirty, preview, tone}]} activeId onSelect onClose onReorder />` | planned |
| `ActivityBar` / `IconRail` | navigation | Vertical icon rail with active indicator + count badges (VSCode activity bar). | `<IconRail items={[{icon, badge, active}]} footer={…} orientation="vertical" />` | planned |
| `StatusBar` | patterns | Slotted app-wide status strip with compact interactive segments. | `<StatusBar left={…} right={…}>` + `<StatusBarItem icon label onClick tone />` | planned |
| `SplitPane` / `ResizablePanels` | patterns | Drag-resizable sidebar/editor splits with min sizes + collapse. | `<PanelGroup direction><Panel min collapsible /><PanelResizeHandle /></PanelGroup>` | planned |
| `SegmentedControl` | inputs | Compact single-choice segmented toggle (Rendered/Source/Diff). `Tabs pills` is nav, not a form control; no disabled-segment support. | `<SegmentedControl options={[{value, icon, label, disabled}]} value onChange size="sm" />` | planned |
| `FileIcon` | display | Per-file-type colored icon set (md/ts/tsx/json/css/csv/img/…), the tree/tabs identity system. | `<FileIcon path="a/b.ts" size="sm" />` + registry override | planned |
| `TreeView` inline rename + row adornments | data | TreeView lacks: inline-edit label mode, right-aligned per-row adornment slot (git letters), row `tone` (strikethrough-deleted), pointer context-menu hook. Nice as TreeView upgrades rather than a new component. | `row: {adornment?, tone?, editing?}`, `onRenameCommit`, `onContextMenu` | planned |
| `TitleBar` | patterns | Window chrome: traffic-light spacer, app identity, centered slot, trailing icon actions. | `<TitleBar title subtitle center={…} actions={…} />` | planned |
| `DiffStatChip` | display | Tiny `+12 -5` added/removed chip used in headers and status bars. | `<DiffStatChip added removed size="sm" />` | planned |
| `Resizable`/`VirtualList` | data | Virtualized rows for big trees/lists (50k-note vaults). | `<VirtualList rowHeight overscan>{row}</VirtualList>` | planned |
| `Toolbar` icon-button density | patterns | Sidebar header micro-toolbars (16px icon buttons, tight gaps). Possibly just a `size="xs"`/`variant="ghost"` addition to `Toolbar`/`Button`. | `Button size="xs" variant="ghost" icon-only` | planned |
| `Shortcut`/`KbdHint` in inputs | inputs | Input with trailing kbd hint (search field `⌘K`) — composable today (Input+Kbd) but recurring enough to standardize. | `<Input trailing={<Kbd>⌘K</Kbd>} />` slot support | planned |

Notes
- Per SKILL.md the proper home for all of these is upstream `my-you-eye` (`src/ui/` +
  showcase). This file is the curated wishlist to drive those PRs.
- Anything that turns out to be pure composition of existing parts should be recorded
  here too, then dropped with a note ("solved by composition") rather than upstreamed.
