/**
 * Mac detection for the handful of places UI copy needs to show the
 * platform-correct modifier glyph (Settings' search placeholder — DESIGN-
 * SPEC "Ctrl+, opens Settings"). `navigator.userAgentData.platform` is the
 * modern, non-deprecated source where it exists (Chromium); `navigator.
 * platform` is deprecated but still the only cross-browser fallback
 * (Firefox/Safari never shipped `userAgentData`) — checking both, newest
 * first, degrades gracefully instead of crashing under SSR/test DOMs that
 * define neither.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  const platform = uaDataPlatform ?? navigator.platform ?? navigator.userAgent ?? "";
  return /mac/i.test(platform);
}

/** The modifier glyph/word for this platform's version of a Ctrl/Cmd shortcut. */
export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}
