/**
 * Ephemeral share/backend state — reachability, auth status, the owner's
 * share list, and in-flight/error flags for the Publish dialog + Shared
 * panel. Deliberately NOT persisted (`zustand/middleware`'s `persist` is
 * not used here): a session cookie (HttpOnly) is the real source of truth
 * for "am I logged in", re-derived via `whoami()` on every boot/probe
 * rather than cached in localStorage. Single-origin refactor (Phase 10.5a,
 * roadmap §5.4): there is no more backend base URL to thread through —
 * `api.ts`'s functions are all relative fetches now, so every action below
 * just calls straight through with no URL parameter at all.
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
  probe: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshShares: () => Promise<void>;
  publish: (input: PublishInput) => Promise<api.ShareOut>;
  /** Phase 10.5 — publish a NEW folder share. Uploads one blob per included
   * entry (`entries`, already filtered by the Publish dialog's checkbox
   * tree — see `share/folderManifest.ts`), then creates the share with the
   * resulting manifest. */
  publishFolder: (input: PublishInput, entries: FolderPublishEntry[]) => Promise<api.ShareOut>;
  /** Phase 10.5 — "Update share" for an EXISTING folder share: republishes
   * the subtree to the SAME slug (`PUT /api/shares/{id}/manifest`). */
  updateFolderManifest: (id: number, entries: FolderPublishEntry[]) => Promise<api.ShareOut>;
  getFolderManifest: (id: number) => Promise<api.ShareManifestOut>;
  updateShare: (id: number, patch: api.SharePatchIn) => Promise<api.ShareOut>;
  regenerate: (id: number) => Promise<api.ShareOut>;
  revoke: (id: number) => Promise<void>;
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

  probe: async () => {
    set({ reachability: "checking" });
    const who = await api.whoami();
    if (who === null) {
      set({ reachability: "offline", authenticated: false, username: null });
      return;
    }
    set({ reachability: "online", authenticated: who.authenticated, username: who.username ?? null });
  },

  login: async (username, password) => {
    set({ loggingIn: true, loginError: null });
    try {
      await api.login(username, password);
      set({ authenticated: true, username, loggingIn: false, reachability: "online" });
      return true;
    } catch (err) {
      const message = err instanceof api.ShareApiError ? err.message : "Could not reach the backend.";
      set({ loggingIn: false, loginError: message });
      return false;
    }
  },

  logout: async () => {
    await api.logout();
    set({ authenticated: false, username: null, shares: [] });
  },

  refreshShares: async () => {
    set({ sharesLoading: true, sharesError: null });
    try {
      const shares = await api.listShares();
      set({ shares, sharesLoading: false });
    } catch (err) {
      const message = err instanceof api.ShareApiError ? err.message : "Could not load shares.";
      set({ sharesLoading: false, sharesError: message });
    }
  },

  publish: async (input) => {
    const blob = await api.createBlob(input.filename, input.content);
    const share = await api.createShare(shareCreatePayload(input, blob.id));
    set((state) => ({ shares: [share, ...state.shares] }));
    return share;
  },

  publishFolder: async (input, entries) => {
    const manifest: api.ManifestEntryIn[] = [];
    for (const entry of entries) {
      const filename = entry.relpath.split("/").pop() ?? entry.relpath;
      const blob = await api.createBlob(filename, entry.content);
      manifest.push({ relpath: entry.relpath, blob_id: blob.id });
    }
    const share = await api.createShare(shareFolderCreatePayload(input, manifest));
    set((state) => ({ shares: [share, ...state.shares] }));
    return share;
  },

  updateFolderManifest: async (id, entries) => {
    const manifest: api.ManifestEntryIn[] = [];
    for (const entry of entries) {
      const filename = entry.relpath.split("/").pop() ?? entry.relpath;
      const blob = await api.createBlob(filename, entry.content);
      manifest.push({ relpath: entry.relpath, blob_id: blob.id });
    }
    const updated = await api.updateShareManifest(id, manifest);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  getFolderManifest: async (id) => api.getShareManifest(id),

  updateShare: async (id, patch) => {
    const updated = await api.patchShare(id, patch);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  regenerate: async (id) => {
    const updated = await api.regenerateShare(id);
    set((state) => ({ shares: state.shares.map((s) => (s.id === id ? updated : s)) }));
    return updated;
  },

  revoke: async (id) => {
    await api.deleteShare(id);
    set({ shares: get().shares.map((s) => (s.id === id ? { ...s, revoked_at: Date.now() / 1000 } : s)) });
  },
}));
