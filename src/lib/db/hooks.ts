/**
 * React Hook for Offline/Sync Management
 * 
 * Provides UI components with offline status and sync indicators
 */

import { useState, useEffect, useCallback } from "react";
import { getSyncManager } from "./sync-manager";

interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  pendingItems: any[];
}

export function useOfflineStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    isSyncing: false,
    pendingCount: 0,
    pendingItems: [],
  });

  useEffect(() => {
    const initManager = async () => {
      const syncManager = await getSyncManager();
      setStatus(syncManager.getStatus());

      const unsubscribe = syncManager.onStatusChange((newStatus) => {
        setStatus(newStatus);
      });

      return unsubscribe;
    };

    let unsubscribe: (() => void) | null = null;
    let unmounted = false;

    initManager().then((unsub) => {
      if (unmounted) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    });

    return () => {
      unmounted = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return status;
}

/**
 * Save data with automatic offline queuing
 */
export async function saveDataOfflineFirst<T>(
  entityType: "project" | "room" | "zone" | "calculation",
  action: "create" | "update" | "delete",
  data: T
): Promise<void> {
  const syncManager = await getSyncManager();

  // Save to local database
  // In real impl: await localDb.save(entityType, data);

  // Queue for sync
  await syncManager.queueChange(entityType, action, data);
}

/**
 * Load data with fallback to local storage
 */
export async function loadDataOfflineSafe<T>(
  entityType: string,
  id: string
): Promise<T | null> {
  const { getLocalDatabase } = await import("./index");
  const db = await getLocalDatabase();

  try {
    // Try cloud first if online
    if (navigator.onLine) {
      // In real impl: return await firebaseApi.get(entityType, id);
    }
  } catch (error) {
    console.log("Cloud fetch failed, using local storage");
  }

  // Fall back to local
  switch (entityType) {
    case "project":
      return (await db.getProject(id)) as any;
    case "room":
      // In real impl: return await db.getRoom(id);
      return null;
    default:
      return null;
  }
}
