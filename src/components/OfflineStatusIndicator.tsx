import React from 'react';
import { Wifi, WifiOff, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import { useOfflineStatus } from '@/lib/db/hooks';

/**
 * Offline Status Indicator Component
 * Shows connection status and sync status in the UI
 */
export function OfflineStatusIndicator() {
  const { isOnline, isSyncing, pendingCount } = useOfflineStatus();

  if (isOnline && !isSyncing && pendingCount === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full border border-green-200">
        <Wifi className="h-3 w-3" />
        <span>Online & Synced</span>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 text-xs rounded-full border border-amber-200">
        <WifiOff className="h-3 w-3" />
        <span>Offline Mode</span>
        {pendingCount > 0 && (
          <span className="ml-1 font-semibold">{pendingCount} pending</span>
        )}
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
        <Cloud className="h-3 w-3 animate-pulse" />
        <span>Syncing...</span>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-orange-50 text-orange-700 text-xs rounded-full border border-orange-200">
        <AlertCircle className="h-3 w-3" />
        <span>{pendingCount} changes waiting to sync</span>
      </div>
    );
  }

  return null;
}
