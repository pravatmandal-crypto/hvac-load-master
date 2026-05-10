// Module-level cache for envelope elements — survives component unmounts (tab switches).
// Keyed by "projectId:roomId". Eliminates repeated Firestore reads when the user
// navigates between Load Calculator and Equipment Selection.

const _cache = new Map<string, any[]>();

const key = (projectId: string, roomId: string) => `${projectId}:${roomId}`;

export const envelopeCache = {
  get: (projectId: string, roomId: string): any[] | undefined =>
    _cache.get(key(projectId, roomId)),

  set: (projectId: string, roomId: string, elements: any[]): void => {
    _cache.set(key(projectId, roomId), elements);
  },

  // Call this when the user saves edits to a room's envelope — keeps cache fresh.
  invalidate: (projectId: string, roomId: string): void => {
    _cache.delete(key(projectId, roomId));
  },

  // Wipe all entries for a project (called when user opens a different project).
  clearProject: (projectId: string): void => {
    const prefix = `${projectId}:`;
    for (const k of _cache.keys()) {
      if (k.startsWith(prefix)) _cache.delete(k);
    }
  },
};
