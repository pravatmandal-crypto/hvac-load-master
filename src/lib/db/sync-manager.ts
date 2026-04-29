/**
 * Data Synchronization Manager
 * 
 * Handles offline/online transitions, sync queuing, and conflict resolution
 * Uses IndexedDB for offline storage and Firebase for cloud persistence
 */

import { getLocalDatabase, DBProject, DBRoom } from "./index";

export type SyncAction = "create" | "update" | "delete";

interface SyncQueueItem {
  id: string;
  entityType: "project" | "room" | "zone" | "calculation";
  action: SyncAction;
  data: any;
  timestamp: number;
  retries: number;
  lastError?: string;
}

export class SyncManager {
  private db: Awaited<ReturnType<typeof getLocalDatabase>> | null = null;
  private syncQueue: Map<string, SyncQueueItem> = new Map();
  private isOnline = navigator.onLine;
  private isSyncing = false;
  private onlineHandler = () => this.handleOnline();
  private offlineHandler = () => this.handleOffline();

  async init(): Promise<void> {
    this.db = await getLocalDatabase();
    window.addEventListener("online", this.onlineHandler);
    window.addEventListener("offline", this.offlineHandler);
    await this.loadQueue();
  }

  destroy(): void {
    window.removeEventListener("online", this.onlineHandler);
    window.removeEventListener("offline", this.offlineHandler);
  }

  private async loadQueue(): Promise<void> {
    // In a real implementation, would load persisted queue
    // For now, start fresh each session
    this.syncQueue.clear();
  }

  private async handleOnline(): Promise<void> {
    console.log("🌐 Resumed connection - starting sync");
    this.isOnline = true;

    if (this.syncQueue.size > 0) {
      await this.syncAll();
    }

    // Inform subscribers
    this.broadcastSyncStatus();
  }

  private handleOffline(): void {
    console.log("📴 Lost connection - switching to offline mode");
    this.isOnline = false;
    this.broadcastSyncStatus();
  }

  /**
   * Queue a change for sync when online
   */
  async queueChange(
    entityType: "project" | "room" | "zone" | "calculation",
    action: SyncAction,
    data: any
  ): Promise<void> {
    const id = `${entityType}_${data.id}_${Date.now()}`;

    const item: SyncQueueItem = {
      id,
      entityType,
      action,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    this.syncQueue.set(id, item);

    // If online, try to sync immediately
    if (this.isOnline && !this.isSyncing) {
      await this.syncAll();
    }

    this.broadcastSyncStatus();
  }

  /**
   * Sync all queued changes
   */
  async syncAll(): Promise<void> {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    this.isSyncing = true;

    try {
      const items = Array.from(this.syncQueue.values());

      for (const item of items) {
        try {
          await this.syncItem(item);
          this.syncQueue.delete(item.id);
        } catch (error) {
          item.retries++;
          item.lastError = (error as Error).message;

          // Retry up to 3 times
          if (item.retries >= 3) {
            console.error(`Failed to sync ${item.id} after 3 retries:`, error);
            // Could notify user here
          }
        }
      }

      if (this.db) {
        await this.db.saveSyncStatus({
          lastSync: Date.now(),
          isOnline: true,
          isPending: this.syncQueue.size,
        });
      }
    } finally {
      this.isSyncing = false;
      this.broadcastSyncStatus();
    }
  }

  /**
   * Sync a single queued item to Firebase
   */
  private async syncItem(item: SyncQueueItem): Promise<void> {
    // This would call Firebase functions
    // For now, mock the sync
    console.log(`Syncing ${item.entityType} ${item.action}:`, item.data);

    // In real implementation:
    // const { syncToFirebase } = await import('./firebase-sync');
    // await syncToFirebase(item);

    return new Promise((resolve) => {
      // Mock 100ms sync delay
      setTimeout(() => {
        console.log(`✓ Synced ${item.id}`);
        resolve();
      }, 100);
    });
  }

  /**
   * Pull data from Firebase and merge with local changes
   * Used on app launch when online
   */
  async pullFromCloud(): Promise<void> {
    if (!this.db || !this.isOnline) {
      console.log("⚠ Not online or database not ready");
      return;
    }

    try {
      // In real implementation:
      // const { fetchFromFirebase } = await import('./firebase-sync');
      // const cloudProjects = await fetchFromFirebase('projects');
      // 
      // for (const cloudProject of cloudProjects) {
      //   const localProject = await this.db.getProject(cloudProject.id);
      //   const merged = this.mergeConflicts(localProject, cloudProject);
      //   await this.db.saveProject(merged);
      // }

      console.log("✓ Cloud pull completed");
    } catch (error) {
      console.error("Failed to pull from cloud:", error);
    }
  }

  /**
   * Simple conflict resolution: Local newer = local wins, else cloud wins
   */
  private mergeConflicts(local: any, cloud: any): any {
    if (!local) return cloud;
    if (!cloud) return local;

    const localTime = local.updatedAt || 0;
    const cloudTime = cloud.syncedAt || 0;

    return localTime > cloudTime ? local : cloud;
  }

  /**
   * Get current sync status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.syncQueue.size,
      pendingItems: Array.from(this.syncQueue.values()),
    };
  }

  /**
   * Broadcast sync status to listeners
   */
  private broadcastSyncStatus(): void {
    const status = this.getStatus();
    window.dispatchEvent(
      new CustomEvent("sync-status-changed", {
        detail: status,
      })
    );
  }

  /**
   * Listen for sync status changes (for UI components)
   */
  onStatusChange(callback: (status: ReturnType<typeof this.getStatus>) => void): () => void {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent;
      callback(customEvent.detail);
    };

    window.addEventListener("sync-status-changed", handler);

    return () => {
      window.removeEventListener("sync-status-changed", handler);
    };
  }

  /**
   * Clear all sync queue (dangerous - only for testing)
   */
  async clearQueue(): Promise<void> {
    this.syncQueue.clear();
    this.broadcastSyncStatus();
  }
}

// Singleton instance
let syncManagerInstance: SyncManager | null = null;

export async function getSyncManager(): Promise<SyncManager> {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager();
    await syncManagerInstance.init();
  }
  return syncManagerInstance;
}
