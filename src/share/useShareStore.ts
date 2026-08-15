/**
 * Ephemeral share/backend state — reachability, auth status, the owner's
 * share list, and in-flight/error flags for the Publish dialog + Shared
 * panel. Deliberately NOT persisted (`zustand/middleware`'s `persist` is
 * not used here): a session cookie (HttpOnly) is the real source of truth
 * for "am I logged in", re-derived via `whoami()` on every boot/probe
 * rather than cached in localStorage. The backend base URL itself IS
 * persisted, but in `useSettingsStore` (see that module's `shareBackendUrl`
 * doc) — this store always takes it as a parameter rather than reading it
 * directly, so it stays decoupled from the settings store and easy to unit
 * test / use from `share/ShareApp.tsx` (which never mounts the rest of the
 * app's stores).
 */
import { create } from "zustand";
import * as api from "./api";
import { shareCreatePayload, shareFolderCreatePayload } from "./sharePolicy";

export type BackendReachability = "unknown" | "checking" | "online" | "offline";

interface ShareStoreState {
  reachability: BackendReachability;
  authenticated: boolean;
  username: string | null;
  loginError: string | null;
  loggingIn: boolean;

  shares: api.ShareOut[];
  sharesLoading: boolean;
  sharesError: string | null;

  /** Re-runs the reachability + auth probe (`GET /api/auth/whoami`,
   * fail-closed — see `api.ts`'s doc). Safe to call on every boot and every
   * time the Settings "Sharing" category mounts; never throws. */
  probe: (baseUrl: string) => Promise<void>;
  login: (baseUrl: string, username: string, password: string) => Promise<boolean>;
  logout: (baseUrl: string) => Promise<void>;
  refreshShares: (baseUrl: string) => Promise<void>;
  publish: (baseUrl: string, input: PublishInput) => Promise<api.ShareOut>;
  /** Phase 10.5 — publish a NEW folder share. Uploads one blob per included
   * entry (`entries`, already filtered by the Publish dialog's checkbox
   * tree — see `share/folderManifest.ts`), then creates the share with the
   * resulting manifest. */
  publishFolder: (baseUrl: string, input: PublishInput, entries: FolderPublishEntry[]) => Promise<api.ShareOut>;
  /** Phase 10.5 — "Update share" for an EXISTING folder share: republishes
   * the subtree to the SAME slug (`PUT /api/shares/{id}/manifest`). */
  updateFolderManifest: (baseUrl: string, id: number, entries: FolderPublishEntry[]) => Promise<api.ShareOut>;
  getFolderManifest: (baseUrl: string, id: number) => Promise<api.ShareManifestOut>;
  updateShare: (baseUrl: string, id: number, patch: api.SharePatchIn) => Promise<api.ShareOut>;
  regenerate: (baseUrl: string, id: number) => Promise<api.ShareOut>;
  revoke: (baseUrl: string, id: number) => Promise<void>;
}

export interface FolderPublishEntry {
  relpath: string;
  content: string;
}

export interface PublishInput {
  sourcePath: string;
  filename: string;
  content: string;
  renderMode: api.RenderMode;
  generalAccess: api.GeneralAccess;
  authMode: api.AuthMode;
  password?: string;
  alias?: string;
  expiresAt?: number;
  grants?: api.GrantIn[];
}

export const useShareStore = create<ShareStoreState>()((set, get) => ({
  reachability: "unknown",
  authenticated: false,
  username: null,
  loginError: null,
  loggingIn: false,

  shares: [],
  sharesLoading: false,
  sharesError: null,

  probe: async (baseUrl) => {
    set({ reachability: "checking" });
    const who = await api.whoami(baseUrl);
    if (who === null) {
      set({ reachability: "offline", authenticated: false, username: null });
      return;
    }
    set({ reachability: "online", authenticated: who.authenticated, username: who.username ?? null });
  },

  login: async (baseUrl, username, password) => {
    set({ loggingIn: true, loginError: null });
    try {
      await api.login(baseUrl, username, password);
      set({ authenticated: true, username, loggingIn: false, reachability: "online" });
      return true;
    } catch (err) {
      const message = err instanceof api.ShareApiError ? err.message : "Could not reach the backend.";
      set({ loggingIn: false, loginError: message });
      return false;
    }
  },

  logout: async (baseUrl) => {
    await api.logout(baseUrl);
    set({ authenticated: false, username: null, shares: [] });
  },

  refreshShares: async (baseUrl) => {
    set({ sharesLoading: true, sharesError: null });
    try {
      const shares = await api.listShares(baseUrl);
      set({ shares, sharesLoading: false });
    } catch (err) {
      const message = err instanceof api.ShareApiError ? err.message : "Could not load shares.";
      set({ sharesLoading: false, sharesError: message });
    }
  },

  publish: async (baseUrl, input) => {
    const blob = await api.createBlob(baseUrl, input.filename, input.content);
    const share = await api.createShare(baseUrl, shareCreatePayload(input, blob.id));
    set((state) => ({ shares: [share, ...state.shares] }));
    return share;
  },

  publishFolder: async (baseUrl, input, entries) => {
    const manifest: api.ManifestEntryIn[] = [];
    for (const entry of entries) {
      const filename = entry.relpath.split("/").pop() ?? entry.relpath;
      const blob = await api.createBlob(baseUrl, filename, entry.content);
      manifest.push({ relpath: entry.relpath, blob_id: blob.id });
    }
    const share = await api.createShare(baseUrl, shareFolderCreatePayload(input, manifest));
    set((state) => ({ shares: [share, ...state.shares] }));
    return share;
  },

  updateFolderManifest: async (baseUrl, id, entries) => {
    const manifest: api.ManifestEntryIn[] = [];
    for (const entry of entries) {
      const filename = entry.relpath.split("/").pop() ?? entry.relpath;
      const blob = await api.createBlob(baseUrl, filename, entry.content);
      manifest.push({ relpath: entry.relpath, blob_id: blob.id });
    }
    const updated = await api.updateShareManifest(baseUrl, id, manifest);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  getFolderManifest: async (baseUrl, id) => api.getShareManifest(baseUrl, id),

  updateShare: async (baseUrl, id, patch) => {
    const updated = await api.patchShare(baseUrl, id, patch);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  regenerate: async (baseUrl, id) => {
    const updated = await api.regenerateShare(baseUrl, id);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  revoke: async (baseUrl, id) => {
    await api.deleteShare(baseUrl, id);
    set({ shares: get().shares.map((s) => (s.id === id ? { ...s, revoked_at: Date.now() / 1000 } : s)) });
  },
}));
