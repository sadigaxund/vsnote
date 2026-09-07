/**
 * `useToast` + `ToastData`/`ToastContext` — split out of `Toast.tsx` itself
 * (which also exports the `Toaster` component) purely to satisfy
 * `react-refresh/only-export-components`: a module that exports both a
 * component and a plain hook can't be fast-refreshed reliably. See
 * `Toast.tsx`'s module doc for why this local Toast exists at all
 * (docs/COMPONENT-BACKLOG.md §2.12).
 */
import { createContext, useContext } from "react";

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "danger";
}

export interface ToastContextValue {
  toast: (data: Omit<ToastData, "id">) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <Toaster />");
  return ctx;
}
