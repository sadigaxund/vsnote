/**
 * App title bar: decorative window chrome + centered global search +
 * trailing icon actions. Composition over `local/TitleBar` + the library's
 * `Input`/`Kbd`/`Button`/`Tooltip`.
 */
import { Button, Input, Kbd, Tooltip } from "my-you-eye";
import { Layout, PanelLeft, Search, Settings, SquareSplitHorizontal } from "lucide-react";
import { TitleBar as TitleBarShell } from "./local/TitleBar";

export interface AppTitleBarProps {
  vaultName: string;
  onToggleSidebar?: () => void;
  onToggleSplit?: () => void;
  onOpenSettings?: () => void;
}

export function AppTitleBar({
  vaultName,
  onToggleSidebar,
  onToggleSplit,
  onOpenSettings,
}: AppTitleBarProps) {
  return (
    <TitleBarShell
      glyph={
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, #7c6cf0))",
            color: "var(--color-primary-fg)",
          }}
        >
          <Layout size={12} strokeWidth={2.5} />
        </span>
      }
      title="Slate"
      subtitle={vaultName}
      center={
        <div style={{ position: "relative", width: 460, maxWidth: "50vw" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-muted)",
              pointerEvents: "none",
            }}
          />
          <Input
            size="sm"
            placeholder="Search files, symbols, commits…"
            aria-label="Search files, symbols, commits"
            style={{
              paddingLeft: 30,
              paddingRight: 44,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <Kbd
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 10,
            }}
          >
            ⌘K
          </Kbd>
        </div>
      }
      actions={
        <>
          <Tooltip content="Toggle sidebar" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle sidebar"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={15} />
            </Button>
          </Tooltip>
          <Tooltip content="Split editor" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Split editor"
              onClick={onToggleSplit}
            >
              <SquareSplitHorizontal size={15} />
            </Button>
          </Tooltip>
          <Tooltip content="Settings" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <Settings size={15} />
            </Button>
          </Tooltip>
        </>
      }
    />
  );
}
