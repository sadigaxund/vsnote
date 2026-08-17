/**
 * Ephemeral server-vault + mirror-remotes state (Phase 17 Milestone C2) —
 * same "not persisted, re-derived from the backend on demand" discipline
 * `share/useShareStore.ts` already established (that module's doc explains
 * why: a session cookie, not localStorage, is the real source of truth).
 * `VaultSetupPanel.tsx` is the one real consumer; `SettingsView.tsx` only
 * reads `useShareStore`'s `reachability`/`authenticated` to decide whether
 * to even mount it.
 *
 * **Never holds a credential.** `VaultRemoteOut` (the only remote shape
 * this store stores) has no field for `ssh_private_key`/`https_token` —
 * see `share/vaultApi.ts`'s module doc. A create/patch call's credential
 * fields pass straight through to the fetch and are never assigned to any
 * field on this store.
 */
import { create } from "zustand";
import * as vaultApi from "../share/vaultApi";

interface VaultStoreState {
  vault: vaultApi.VaultOut | null;
  vaultLoading: boolean;
  vaultError: string | null;
  /** `initVault` call in flight — separate from `vaultLoading` (the GET
   * probe) so the panel can show "Creating..." on the init button
   * specifically without also disabling/skeletonizing the whole row. */
  initializing: boolean;

  remotes: vaultApi.VaultRemoteOut[];
  remotesLoading: boolean;
  remotesError: string | null;
  /** Remote ids with a create/patch/delete/mirror/test currently in
   * flight — keyed so multiple rows can act independently without a
   * global "something is loading" flag blocking unrelated rows. */
  pendingRemoteIds: Set<number>;
  /** Most recent "Test connection" result per remote id, ephemeral (reset
   * on every re-test, never persisted, cleared when the remote itself is
   * deleted). */
  testResults: Record<number, vaultApi.RemoteTestOut>;

  fetchVault: () => Promise<void>;
  /** Returns the new `VaultOut` on success, `null` on failure (the error
   * lands in `vaultError` either way — same "return + also set state"
   * pattern `useShareStore.updateAdminSettings` uses so a caller can react
   * to success without a second read of the store). */
  initVault: (branch?: string) => Promise<vaultApi.VaultOut | null>;

  fetchRemotes: () => Promise<void>;
  createRemote: (payload: vaultApi.VaultRemoteCreateIn) => Promise<vaultApi.VaultRemoteOut | null>;
  patchRemote: (id: number, payload: vaultApi.VaultRemotePatchIn) => Promise<vaultApi.VaultRemoteOut | null>;
  deleteRemote: (id: number) => Promise<boolean>;
  mirrorNow: (id: number) => Promise<vaultApi.MirrorRunOut | null>;
  testRemote: (id: number) => Promise<vaultApi.RemoteTestOut | null>;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof vaultApi.ShareApiError ? err.message : fallback;
}

function withPending(set: (fn: (s: VaultStoreState) => Partial<VaultStoreState>) => void, id: number, pending: boolean) {
  set((s) => {
    const next = new Set(s.pendingRemoteIds);
    if (pending) next.add(id);
    else next.delete(id);
    return { pendingRemoteIds: next };
  });
}

export const useVaultStore = create<VaultStoreState>()((set, get) => ({
  vault: null,
  vaultLoading: false,
  vaultError: null,
  initializing: false,

  remotes: [],
  remotesLoading: false,
  remotesError: null,
  pendingRemoteIds: new Set(),
  testResults: {},

  fetchVault: async () => {
    set({ vaultLoading: true, vaultError: null });
    try {
      const vault = await vaultApi.getVault();
      set({ vault, vaultLoading: false });
    } catch (err) {
      set({ vaultLoading: false, vaultError: messageFor(err, "Could not load the server vault's state.") });
    }
  },

  initVault: async (branch) => {
    set({ initializing: true, vaultError: null });
    try {
      const vault = await vaultApi.initVault(branch ? { branch } : {});
      set({ vault, initializing: false });
      return vault;
    } catch (err) {
      set({ initializing: false, vaultError: messageFor(err, "Could not create the vault repository.") });
      return null;
    }
  },

  fetchRemotes: async () => {
    set({ remotesLoading: true, remotesError: null });
    try {
      const remotes = await vaultApi.listVaultRemotes();
      set({ remotes, remotesLoading: false });
    } catch (err) {
      set({ remotesLoading: false, remotesError: messageFor(err, "Could not load mirror remotes.") });
    }
  },

  createRemote: async (payload) => {
    set({ remotesError: null });
    try {
      const remote = await vaultApi.createVaultRemote(payload);
      set((s) => ({ remotes: [...s.remotes, remote] }));
      return remote;
    } catch (err) {
      set({ remotesError: messageFor(err, "Could not add the remote.") });
      return null;
    }
  },

  patchRemote: async (id, payload) => {
    withPending(set, id, true);
    set({ remotesError: null });
    try {
      const updated = await vaultApi.patchVaultRemote(id, payload);
      set((s) => ({ remotes: s.remotes.map((r) => (r.id === id ? updated : r)) }));
      return updated;
    } catch (err) {
      set({ remotesError: messageFor(err, "Could not update the remote.") });
      return null;
    } finally {
      withPending(set, id, false);
    }
  },

  deleteRemote: async (id) => {
    withPending(set, id, true);
    set({ remotesError: null });
    try {
      await vaultApi.deleteVaultRemote(id);
      set((s) => {
        const testResults = { ...s.testResults };
        delete testResults[id];
        return { remotes: s.remotes.filter((r) => r.id !== id), testResults };
      });
      return true;
    } catch (err) {
      set({ remotesError: messageFor(err, "Could not delete the remote.") });
      return false;
    } finally {
      withPending(set, id, false);
    }
  },

  mirrorNow: async (id) => {
    withPending(set, id, true);
    try {
      const result = await vaultApi.mirrorVaultRemoteNow(id);
      // A successful/failed run also updates the remote's own
      // last_status/last_error server-side — re-fetch that one row's worth
      // of truth from the list rather than guessing it locally.
      await get().fetchRemotes();
      return result;
    } catch (err) {
      set({ remotesError: messageFor(err, "Could not run the mirror.") });
      return null;
    } finally {
      withPending(set, id, false);
    }
  },

  testRemote: async (id) => {
    withPending(set, id, true);
    try {
      const result = await vaultApi.testVaultRemote(id);
      set((s) => ({ testResults: { ...s.testResults, [id]: result } }));
      return result;
    } catch (err) {
      set({ remotesError: messageFor(err, "Could not test the remote.") });
      return null;
    } finally {
      withPending(set, id, false);
    }
  },
}));
