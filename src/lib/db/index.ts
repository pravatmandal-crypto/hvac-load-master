/**
 * Local Database Layer for Offline-First Architecture
 * 
 * Uses IndexedDB to store all technical data, projects, and calculations
 * Syncs with Firebase when internet is available
 * Provides offline access to all HVAC and electrical engineering data
 */

interface DBProject {
  id: string;
  name: string;
  location: string;
  systemType: 'VAV' | 'VRF' | 'Hybrid' | 'CAC' | 'WSHP' | 'Chiller';
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  needsSync: boolean;
  data: Record<string, any>;
}

interface DBZone {
  id: string;
  projectId: string;
  name: string;
  outdoorTemp: number;
  indoorTemp: number;
  outdoorHumidity: number;
  indoorHumidity: number;
  createdAt: number;
  updatedAt: number;
  needsSync: boolean;
}

interface DBRoom {
  id: string;
  projectId: string;
  zoneId: string;
  name: string;
  area: number;
  volume: number;
  sensibleLoad: number;
  latentLoad: number;
  totalLoad: number;
  heatingLoad: number;
  createdAt: number;
  updatedAt: number;
  needsSync: boolean;
  data: Record<string, any>;
}

interface DBCalculation {
  id: string;
  projectId: string;
  type: 'hvac_load' | 'cable_sizing' | 'duct_sizing' | 'pipe_sizing' | 'psychrometric';
  timestamp: number;
  inputs: Record<string, any>;
  results: Record<string, any>;
  notes: string;
  needsSync: boolean;
}

interface SyncStatus {
  lastSync: number;
  isOnline: boolean;
  isPending: number;
  lastError?: string;
}

class LocalDatabase {
    async saveZone(zone: DBZone): Promise<void> {
      if (!this.db) throw new Error("Database not initialized");
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(["zones"], "readwrite");
        const store = tx.objectStore("zones");
        const request = store.put({
          ...zone,
          updatedAt: Date.now(),
          needsSync: true,
        });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
  private dbName = "HVAC_LoadMaster_v1";
  private version = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Projects store
        if (!db.objectStoreNames.contains("projects")) {
          const projectStore = db.createObjectStore("projects", { keyPath: "id" });
          projectStore.createIndex("createdAt", "createdAt");
          projectStore.createIndex("needsSync", "needsSync");
        }

        // Zones store
        if (!db.objectStoreNames.contains("zones")) {
          const zoneStore = db.createObjectStore("zones", { keyPath: "id" });
          zoneStore.createIndex("projectId", "projectId");
          zoneStore.createIndex("needsSync", "needsSync");
        }

        // Rooms store
        if (!db.objectStoreNames.contains("rooms")) {
          const roomStore = db.createObjectStore("rooms", { keyPath: "id" });
          roomStore.createIndex("projectId", "projectId");
          roomStore.createIndex("zoneId", "zoneId");
          roomStore.createIndex("needsSync", "needsSync");
        }

        // Calculations store
        if (!db.objectStoreNames.contains("calculations")) {
          const calcStore = db.createObjectStore("calculations", { keyPath: "id" });
          calcStore.createIndex("projectId", "projectId");
          calcStore.createIndex("timestamp", "timestamp");
          calcStore.createIndex("type", "type");
        }

        // Technical data store (read-only, populated on init)
        if (!db.objectStoreNames.contains("technicalData")) {
          db.createObjectStore("technicalData", { keyPath: "category" });
        }

        // Sync status store
        if (!db.objectStoreNames.contains("syncStatus")) {
          db.createObjectStore("syncStatus", { keyPath: "id" });
        }
      };
    });
  }

  async saveProject(project: DBProject): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["projects"], "readwrite");
      const store = tx.objectStore("projects");
      const request = store.put({
        ...project,
        updatedAt: Date.now(),
        needsSync: true,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getProject(id: string): Promise<DBProject | undefined> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["projects"], "readonly");
      const store = tx.objectStore("projects");
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllProjects(): Promise<DBProject[]> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["projects"], "readonly");
      const store = tx.objectStore("projects");
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async saveRoom(room: DBRoom): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["rooms"], "readwrite");
      const store = tx.objectStore("rooms");
      const request = store.put({
        ...room,
        updatedAt: Date.now(),
        needsSync: true,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getRoomsByZone(zoneId: string): Promise<DBRoom[]> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["rooms"], "readonly");
      const store = tx.objectStore("rooms");
      const index = store.index("zoneId");
      const request = index.getAll(zoneId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async saveCalculation(calculation: DBCalculation): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["calculations"], "readwrite");
      const store = tx.objectStore("calculations");
      const request = store.put(calculation);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCalculationsByProject(projectId: string): Promise<DBCalculation[]> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["calculations"], "readonly");
      const store = tx.objectStore("calculations");
      const index = store.index("projectId");
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getTechnicalData(category: string): Promise<any> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["technicalData"], "readonly");
      const store = tx.objectStore("technicalData");
      const request = store.get(category);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.data || null);
    });
  }

  async saveTechnicalData(category: string, data: any): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["technicalData"], "readwrite");
      const store = tx.objectStore("technicalData");
      const request = store.put({ category, data, timestamp: Date.now() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async saveSyncStatus(status: SyncStatus): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["syncStatus"], "readwrite");
      const store = tx.objectStore("syncStatus");
      const request = store.put({ id: "current", ...status });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSyncStatus(): Promise<SyncStatus | undefined> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["syncStatus"], "readonly");
      const store = tx.objectStore("syncStatus");
      const request = store.get("current");

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getPendingSyncItems(): Promise<{
    projects: DBProject[];
    rooms: DBRoom[];
  }> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["projects", "rooms"], "readonly");

      const projectStore = tx.objectStore("projects");
      const projectIndex = projectStore.index("needsSync");
      const projectRequest = projectIndex.getAll(true as unknown as IDBValidKey);

      const roomStore = tx.objectStore("rooms");
      const roomIndex = roomStore.index("needsSync");
      const roomRequest = roomIndex.getAll(true as unknown as IDBValidKey);

      let completed = 0;
      let projects: DBProject[] = [];
      let rooms: DBRoom[] = [];

      projectRequest.onsuccess = () => {
        projects = projectRequest.result;
        completed++;
        if (completed === 2) {
          resolve({ projects, rooms });
        }
      };

      roomRequest.onsuccess = () => {
        rooms = roomRequest.result;
        completed++;
        if (completed === 2) {
          resolve({ projects, rooms });
        }
      };

      projectRequest.onerror = () => reject(projectRequest.error);
      roomRequest.onerror = () => reject(roomRequest.error);
    });
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["projects", "zones", "rooms"], "readwrite");
      tx.objectStore("projects").delete(id);
      const zoneIndex = tx.objectStore("zones").index("projectId");
      const zoneReq = zoneIndex.getAll(id);
      zoneReq.onsuccess = () => {
        zoneReq.result.forEach((zone: any) => tx.objectStore("zones").delete(zone.id));
      };
      const roomIndex = tx.objectStore("rooms").index("projectId");
      const roomReq = roomIndex.getAll(id);
      roomReq.onsuccess = () => {
        roomReq.result.forEach((room: any) => tx.objectStore("rooms").delete(room.id));
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  }

  async deleteZone(id: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["zones", "rooms"], "readwrite");
      tx.objectStore("zones").delete(id);
      const roomIndex = tx.objectStore("rooms").index("zoneId");
      const roomReq = roomIndex.getAll(id);
      roomReq.onsuccess = () => {
        roomReq.result.forEach((room: any) => tx.objectStore("rooms").delete(room.id));
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  }

  async deleteRoom(id: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["rooms"], "readwrite");
      tx.objectStore("rooms").delete(id);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  }

  async deleteEnvelopeElement(roomId: string, elementId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["rooms"], "readwrite");
      const store = tx.objectStore("rooms");
      const getReq = store.get(roomId);
      getReq.onsuccess = () => {
        const room = getReq.result;
        if (room?.data && Array.isArray(room.data.envelopeElements)) {
          room.data.envelopeElements = room.data.envelopeElements.filter((el: any) => el.id !== elementId);
          store.put(room);
        }
        tx.oncomplete = () => resolve();
      };
      getReq.onerror = () => reject(getReq.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRoomsByProject(projectId: string): Promise<DBRoom[]> {
    if (!this.db) throw new Error("Database not initialized");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(["rooms"], "readonly");
      const store = tx.objectStore("rooms");
      const index = store.index("projectId");
      const request = index.getAll(projectId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
}

// Singleton
let dbInstance: LocalDatabase | null = null;
let initPromise: Promise<LocalDatabase> | null = null;

export async function getLocalDatabase(): Promise<LocalDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = new LocalDatabase();
    await db.init();
    dbInstance = db;
    return db;
  })();
  return initPromise;
}

export type { DBProject, DBZone, DBRoom, DBCalculation, SyncStatus };