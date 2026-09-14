import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isDynamicImportError(error: any): boolean {
  if (!error) return false;
  const msg = String(error?.message || error).toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("dynamically imported module")
  );
}

/**
 * Wraps dynamic component imports with auto-recovery for stale chunks after new deployments.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  name: string = "component"
): LazyExoticComponent<T> {
  return lazy(async () => {
    const sessionKey = `mrx_chunk_retry_${name}`;
    const pageHasAlreadyBeenForceRefreshed = typeof window !== "undefined" && window.sessionStorage
      ? window.sessionStorage.getItem(sessionKey) === "true"
      : false;

    try {
      const component = await componentImport();
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem(sessionKey);
      }
      return component;
    } catch (error: any) {
      if (isDynamicImportError(error) && !pageHasAlreadyBeenForceRefreshed && typeof window !== "undefined") {
        console.warn(`[LazyRetry] Dynamic chunk import for '${name}' failed. Auto-refreshing window once to fetch latest build...`);
        if (window.sessionStorage) {
          window.sessionStorage.setItem(sessionKey, "true");
        }
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
