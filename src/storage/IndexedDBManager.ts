/**
 * Native IndexedDB Access Layer for Rekapu Extension
 * 
 * Provides Promise-based CRUD operations without external dependencies
 * Implements the schema defined in IndexedDBSchema.ts
 */

import {
  INDEXEDDB_SCHEMA,
  STORE_NAMES,
  INDEX_NAMES,
  PERFORMANCE_CONFIG,
  GlobalSettingsRecord,
  DomainRecord,
  CardRecord,
  TagRecord,
  ActiveTagRecord,
  CardResponseRecord,
  StorageStatsRecord,
  MigrationDataRecord,
  DailyStatsRecord,
  StreakDataRecord,
  DomainBlockingStatsRecord,
  TagPerformanceRecord,
  SnapshotRecord,
  SchemaValidator
} from './IndexedDBSchema';
import { performanceMonitor } from './IndexedDBPerformanceMonitor';

/**
 * Result wrapper for consistent error handling
 */
export interface IndexedDBResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Transaction configuration
 */
interface TransactionConfig {
  stores: string[];
  mode: 'readonly' | 'readwrite';
  durability?: 'default' | 'strict' | 'relaxed';
}

/**
 * Native IndexedDB Manager
 * Handles database operations with proper error handling and type safety
 */
export class IndexedDBManager {
  private static instance: IndexedDBManager;
  private database: IDBDatabase | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Singleton pattern for database connection management
   */
  static getInstance(): IndexedDBManager {
    if (!IndexedDBManager.instance) {
      IndexedDBManager.instance = new IndexedDBManager();
    }
    return IndexedDBManager.instance;
  }

  /**
   * Initialize the database with proper schema setup
   */
  async initialize(): Promise<IndexedDBResult<boolean>> {
    if (this.isInitialized) {
      return { success: true, data: true };
    }

    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: `Database initialization failed: ${error}` };
      }
    }

    this.initializationPromise = this.performInitialization();
    
    try {
      await this.initializationPromise;
      return { success: true, data: true };
    } catch (error) {
      return { success: false, error: `Database initialization failed: ${error}` };
    }
  }

  /**
   * Perform the actual database initialization
   */
  private async performInitialization(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INDEXEDDB_SCHEMA.name, INDEXEDDB_SCHEMA.version);
      
      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.database = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction!;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion;
        
        try {
          this.createObjectStores(db, transaction);
          
          if (oldVersion > 0) {
            if (oldVersion < 4 && newVersion && newVersion >= 4) {
              this.migrateToVersion4(db, transaction);
            }
            if (oldVersion < 5 && newVersion && newVersion >= 5) {
              this.migrateToVersion5(db, transaction);
            }
            if (oldVersion < 6 && newVersion && newVersion >= 6) {
              this.migrateToVersion6(db, transaction);
            }
            if (oldVersion < 7 && newVersion && newVersion >= 7) {
              this.migrateToVersion7(db, transaction);
            }
            if (oldVersion < 8 && newVersion && newVersion >= 8) {
              this.migrateToVersion8(db, transaction);
            }
            if (oldVersion < 9 && newVersion && newVersion >= 9) {
              this.migrateToVersion9(db, transaction);
            }
            if (oldVersion < 10 && newVersion && newVersion >= 10) {
              this.migrateToVersion10(db, transaction);
            }
          }
        } catch (error) {
          reject(new Error(`Failed to create object stores: ${error}`));
        }
      };
    });
  }

  /**
   * Create all object stores and indexes according to schema
   */
  private createObjectStores(db: IDBDatabase, transaction: IDBTransaction): void {
    const { stores } = INDEXEDDB_SCHEMA;
    
    for (const [storeName, storeConfig] of Object.entries(stores)) {
      if (db.objectStoreNames.contains(storeName)) {
        continue;
      }

      const store = db.createObjectStore(storeName, {
        keyPath: storeConfig.keyPath,
        autoIncrement: storeConfig.autoIncrement || false
      });

      for (const [indexName, indexConfig] of Object.entries(storeConfig.indexes)) {
        store.createIndex(indexName, indexConfig.keyPath, {
          unique: indexConfig.unique || false,
          multiEntry: indexConfig.multiEntry || false
        });
      }
    }
  }

  /**
   * Migrate to version 4 - Add isDraft field to existing cards
   */
  private migrateToVersion4(db: IDBDatabase, transaction: IDBTransaction): void {
    if (!transaction.objectStoreNames.contains('cards')) {
      return;
    }
    
    const cardsStore = transaction.objectStore('cards');
    const cursorRequest = cardsStore.openCursor();
    
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const card = cursor.value;
        if (!card.hasOwnProperty('isDraft')) {
          card.isDraft = false;
          cursor.update(card);
        }
        cursor.continue();
      }
    };
  }

  /**
   * Migrate to version 5 - Rename 'cloze' card type to 'basic'
   */
  private migrateToVersion5(db: IDBDatabase, transaction: IDBTransaction): void {
    if (!transaction.objectStoreNames.contains('cards')) {
      return;
    }
    
    const cardsStore = transaction.objectStore('cards');
    const cursorRequest = cardsStore.openCursor();
    
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const card = cursor.value;
        if (card.type === 'cloze') {
          card.type = 'basic';
          cursor.update(card);
        }
        cursor.continue();
      }
    };
  }

  /**
   * Migrate to version 6 - Add audioCache object store for TTS
   */
  private migrateToVersion6(db: IDBDatabase, transaction: IDBTransaction): void {
    // audioCache store created by createObjectStores
  }

  /**
   * Migrate to version 7 - Fix initialization race condition
   */
  private migrateToVersion7(db: IDBDatabase, transaction: IDBTransaction): void {
    // No data changes needed
  }

  /**
   * Migrate to version 8 - Fix invalid compound index with multiEntry
   * Recreates cards store to remove any invalid indexes
   */
  private migrateToVersion8(db: IDBDatabase, transaction: IDBTransaction): void {
    if (!transaction.objectStoreNames.contains('cards')) {
      return;
    }

    // Save all existing cards synchronously
    const oldStore = transaction.objectStore('cards');
    const cards: any[] = [];
    const cursorRequest = oldStore.openCursor();
    
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cards.push(cursor.value);
        cursor.continue();
      } else {
        // All data collected, now recreate the store
        try {
          // Delete the old store
          db.deleteObjectStore('cards');
          
          // Recreate with correct schema
          const storeConfig = INDEXEDDB_SCHEMA.stores['cards'];
          const newStore = db.createObjectStore('cards', {
            keyPath: storeConfig.keyPath,
            autoIncrement: storeConfig.autoIncrement || false
          });

          // Recreate all indexes from schema
          for (const [indexName, indexConfig] of Object.entries(storeConfig.indexes)) {
            newStore.createIndex(indexName, indexConfig.keyPath, {
              unique: indexConfig.unique || false,
              multiEntry: indexConfig.multiEntry || false
            });
          }

          // Restore all cards
          for (const card of cards) {
            newStore.add(card);
          }
        } catch (error) {
          console.error('Migration to version 8 failed:', error);
          throw error;
        }
      }
    };
  }

  /**
   * Migrate to version 9 - Renamed 'questions' to 'cards' terminology
   * No data migration needed, terminology change only
   */
  private migrateToVersion9(db: IDBDatabase, transaction: IDBTransaction): void {
    // Version 9 was a terminology change in comments and documentation only
    // No database structure changes required
  }

  /**
   * Migrate to version 10 - Remove broken cardAndTimeLegacy index
   * Recreates cardResponses store with fixed indexes
   */
  private migrateToVersion10(db: IDBDatabase, transaction: IDBTransaction): void {
    if (!transaction.objectStoreNames.contains('cardResponses')) {
      return;
    }

    // Save all existing responses synchronously
    const oldStore = transaction.objectStore('cardResponses');
    const responses: any[] = [];
    const cursorRequest = oldStore.openCursor();
    
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        responses.push(cursor.value);
        cursor.continue();
      } else {
        // All data collected, now recreate the store
        try {
          // Delete the old store
          db.deleteObjectStore('cardResponses');
          
          // Recreate with correct schema (without cardAndTimeLegacy index)
          const storeConfig = INDEXEDDB_SCHEMA.stores['cardResponses'];
          const newStore = db.createObjectStore('cardResponses', {
            keyPath: storeConfig.keyPath,
            autoIncrement: storeConfig.autoIncrement || false
          });

          // Recreate all indexes from schema (cardAndTimeLegacy is now removed)
          for (const [indexName, indexConfig] of Object.entries(storeConfig.indexes)) {
            newStore.createIndex(indexName, indexConfig.keyPath, {
              unique: indexConfig.unique || false,
              multiEntry: indexConfig.multiEntry || false
            });
          }

          // Restore all responses
          for (const response of responses) {
            newStore.add(response);
          }
        } catch (error) {
          console.error('Migration to version 10 failed:', error);
          throw error;
        }
      }
    };
  }

  /**
   * Execute a transaction with proper error handling
   */
  private async executeTransaction<T>(
    config: TransactionConfig,
    operation: (stores: Record<string, IDBObjectStore>) => Promise<T>
  ): Promise<IndexedDBResult<T>> {
    // Ensure database is initialized before attempting transaction
    const initResult = await this.initialize();
    if (!initResult.success) {
      return { success: false, error: initResult.error };
    }

    // Double-check that database is set and all required stores exist
    if (!this.database) {
      return { success: false, error: 'Database connection not established' };
    }

    // Verify all required stores exist before creating transaction
    for (const storeName of config.stores) {
      if (!this.database.objectStoreNames.contains(storeName)) {
        return { 
          success: false, 
          error: `Object store "${storeName}" not found. Database may need reinitialization.` 
        };
      }
    }

    // Track transaction performance
    performanceMonitor.trackTransactionStart();
    const operationName = `Transaction[${config.stores.join(',')}]`;

    try {
      const transaction = this.database.transaction(config.stores, config.mode, {
        durability: config.durability || 'default'
      });

      // Create store map for easy access
      const stores: Record<string, IDBObjectStore> = {};
      for (const storeName of config.stores) {
        stores[storeName] = transaction.objectStore(storeName);
      }

      // Execute the operation with performance tracking
      const operationPromise = operation(stores);
      const result = await performanceMonitor.trackOperation(operationName, operationPromise, {
        stores: config.stores,
        mode: config.mode
      });

      // Wait for transaction to complete
      await this.waitForTransaction(transaction);

      return { success: true, data: result };
    } catch (error) {
      return { 
        success: false, 
        error: `Transaction failed: ${error instanceof Error ? error.message : error}` 
      };
    } finally {
      performanceMonitor.trackTransactionEnd();
    }
  }

  /**
   * Wait for a transaction to complete
   */
  private waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
  }

  /**
   * Convert IDBRequest to Promise
   */
  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // =================== GLOBAL SETTINGS OPERATIONS ===================

  /**
   * Get global settings
   */
  async getGlobalSettings(): Promise<IndexedDBResult<GlobalSettingsRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.GLOBAL_SETTINGS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.GLOBAL_SETTINGS].get('settings');
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Set global settings
   */
  async setGlobalSettings(settings: GlobalSettingsRecord): Promise<IndexedDBResult<boolean>> {
    // Validate the record
    if (!SchemaValidator.validateRecord(settings, STORE_NAMES.GLOBAL_SETTINGS)) {
      return { success: false, error: 'Invalid settings record' };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.GLOBAL_SETTINGS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.GLOBAL_SETTINGS].put(settings);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  // =================== DOMAIN OPERATIONS ===================

  /**
   * Get all domains
   */
  async getAllDomains(): Promise<IndexedDBResult<DomainRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAINS].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Count total domains (efficient - no data loading)
   */
  async countDomains(): Promise<IndexedDBResult<number>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAINS].count();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get domain by name
   */
  async getDomain(domain: string): Promise<IndexedDBResult<DomainRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAINS].get(domain);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Set domain configuration
   */
  async setDomain(domain: DomainRecord): Promise<IndexedDBResult<boolean>> {
    if (!SchemaValidator.validateRecord(domain, STORE_NAMES.DOMAINS)) {
      return { success: false, error: 'Invalid domain record' };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAINS].put(domain);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Remove domain
   */
  async removeDomain(domain: string): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAINS].delete(domain);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Get active domains efficiently
   */
  async getActiveDomains(): Promise<IndexedDBResult<DomainRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAINS], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.DOMAINS].index(INDEX_NAMES.DOMAINS.IS_ACTIVE);
        const request = index.getAll(IDBKeyRange.only(true));
        return await this.requestToPromise(request);
      }
    );
  }

  // =================== CARD OPERATIONS ===================

  /**
   * Get all cards
   */
  async getAllCards(): Promise<IndexedDBResult<CardRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARDS].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Count total cards (efficient - no data loading)
   */
  async countCards(): Promise<IndexedDBResult<number>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARDS].count();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get card by ID
   */
  async getCard(id: string): Promise<IndexedDBResult<CardRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARDS].get(id);
        return await this.requestToPromise(request);
      }
    );
  }

  async getCardsByIds(ids: string[]): Promise<IndexedDBResult<CardRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const cards: CardRecord[] = [];
        for (const id of ids) {
          const request = stores[STORE_NAMES.CARDS].get(id);
          const card = await this.requestToPromise(request);
          if (card) {
            cards.push(card);
          }
        }
        return cards;
      }
    );
  }

  /**
   * Create or update card
   */
  async setCard(card: CardRecord): Promise<IndexedDBResult<boolean>> {
    if (!SchemaValidator.validateRecord(card, STORE_NAMES.CARDS)) {
      return { success: false, error: 'Invalid card record' };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARDS].put(card);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Batch insert/update cards in a single transaction
   */
  async setCardsBatch(cards: CardRecord[]): Promise<IndexedDBResult<number>> {
    if (cards.length === 0) {
      return { success: true, data: 0 };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readwrite' },
      async (stores) => {
        const store = stores[STORE_NAMES.CARDS];
        let count = 0;
        for (const card of cards) {
          if (SchemaValidator.validateRecord(card, STORE_NAMES.CARDS)) {
            store.put(card);
            count++;
          }
        }
        return count;
      }
    );
  }

  /**
   * Batch insert/update tags in a single transaction
   */
  async setTagsBatch(tags: TagRecord[]): Promise<IndexedDBResult<number>> {
    if (tags.length === 0) {
      return { success: true, data: 0 };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readwrite' },
      async (stores) => {
        const store = stores[STORE_NAMES.TAGS];
        let count = 0;
        for (const tag of tags) {
          store.put(tag);
          count++;
        }
        return count;
      }
    );
  }

  /**
   * Remove card
   */
  async removeCard(id: string): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARDS].delete(id);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  async getDueCards(limit?: number): Promise<IndexedDBResult<CardRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.CARDS].index(INDEX_NAMES.CARDS.DUE_DATE);
        const range = IDBKeyRange.upperBound(Date.now());
        const request = index.getAll(range, limit || PERFORMANCE_CONFIG.QUERY_LIMITS.DUE_CARDS);
        return await this.requestToPromise(request);
      }
    );
  }

  async getDueCardsByTags(tagNames: string[], excludeIds: string[] = [], limit?: number): Promise<IndexedDBResult<CardRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const now = Date.now();
        const dueCards: CardRecord[] = [];
        const seenIds = new Set<string>(excludeIds);

        // If no tags specified, get all due cards
        if (tagNames.length === 0) {
          const index = stores[STORE_NAMES.CARDS].index(INDEX_NAMES.CARDS.DUE_DATE);
          const range = IDBKeyRange.upperBound(now);
          const request = index.getAll(range, limit || PERFORMANCE_CONFIG.QUERY_LIMITS.DUE_CARDS);
          const allDue = await this.requestToPromise(request);
          
          return allDue.filter(q => !excludeIds.includes(q.id) && !q.isDraft);
        }

        // Use tag index for each tag, then filter by due date
        for (const tagName of tagNames) {
          const tagIndex = stores[STORE_NAMES.CARDS].index(INDEX_NAMES.CARDS.TAGS);
          const request = tagIndex.getAll(IDBKeyRange.only(tagName));
          const tagCards = await this.requestToPromise(request);
          
          for (const card of tagCards) {
            // Skip if already seen, excluded, or draft
            if (seenIds.has(card.id) || card.isDraft) {
              continue;
            }
            
            // Check if due (handle cloze cards with multiple deletions)
            let isDue = false;
            if (card.type === 'cloze' && card.clozeDeletions) {
              // For cloze, check if any deletion is due
              isDue = card.clozeDeletions.some((d: { algorithm: { dueDate: number } }) => 
                d.algorithm && d.algorithm.dueDate <= now
              );
            } else if (card.algorithm) {
              isDue = card.algorithm.dueDate <= now;
            }
            
            if (isDue) {
              dueCards.push(card);
              seenIds.add(card.id);
              
              // Stop if we've reached the limit
              if (limit && dueCards.length >= limit) {
                return dueCards;
              }
            }
          }
        }
        
        return dueCards;
      }
    );
  }

  /**
   * Get cards by tag
   */
  async getCardsByTag(tagName: string, limit?: number): Promise<IndexedDBResult<CardRecord[]>> {
    // Validate tagName
    if (!tagName || typeof tagName !== 'string' || tagName.trim().length === 0) {
      return { success: true, data: [] };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.CARDS].index(INDEX_NAMES.CARDS.TAGS);
        const request = index.getAll(IDBKeyRange.only(tagName), limit || PERFORMANCE_CONFIG.QUERY_LIMITS.SEARCH_RESULTS);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get cards by multiple tags
   */
  async getCardsByTags(tagNames: string[]): Promise<IndexedDBResult<CardRecord[]>> {
    // Validate tagNames
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
      return { success: true, data: [] };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readonly' },
      async (stores) => {
        const cards = new Map<string, CardRecord>();
        
        for (const tagName of tagNames) {
          // Validate each tagName
          if (!tagName || typeof tagName !== 'string' || tagName.trim().length === 0) {
            continue;
          }
          
          const index = stores[STORE_NAMES.CARDS].index(INDEX_NAMES.CARDS.TAGS);
          const request = index.getAll(IDBKeyRange.only(tagName));
          const tagCards = await this.requestToPromise(request);
          
          for (const card of tagCards) {
            cards.set(card.id, card);
          }
        }
        
        return Array.from(cards.values());
      }
    );
  }

  async getAllUniqueTagNames(): Promise<IndexedDBResult<string[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readonly' },
      async (stores) => {
        // Get all tag names from TAGS store (source of truth)
        // Tags are auto-created when cards are saved, so this is always complete
        const tagsRequest = stores[STORE_NAMES.TAGS].getAll();
        const tags = await this.requestToPromise(tagsRequest);
        const tagNames = tags.map((tag: TagRecord) => tag.name).sort();
        return tagNames;
      }
    );
  }

  // =================== TAG OPERATIONS ===================

  /**
   * Get all tags
   */
  async getAllTags(): Promise<IndexedDBResult<TagRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAGS].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get tag by ID
   */
  async getTag(id: string): Promise<IndexedDBResult<TagRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAGS].get(id);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Set tag
   */
  async setTag(tag: TagRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAGS].put(tag);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Remove tag
   */
  async removeTag(id: string): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAGS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAGS].delete(id);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  // =================== ACTIVE TAGS OPERATIONS ===================

  /**
   * Get all active tags
   */
  async getActiveTags(): Promise<IndexedDBResult<ActiveTagRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.ACTIVE_TAGS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.ACTIVE_TAGS].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Add active tag
   */
  async addActiveTag(activeTag: ActiveTagRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.ACTIVE_TAGS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.ACTIVE_TAGS].put(activeTag);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Remove active tag
   */
  async removeActiveTag(id: string): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.ACTIVE_TAGS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.ACTIVE_TAGS].delete(id);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  // =================== CARD RESPONSE OPERATIONS ===================

  /**
   * Add card response
   */
  async addCardResponse(response: Omit<CardResponseRecord, 'id'>): Promise<IndexedDBResult<number>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARD_RESPONSES].add(response);
        const result = await this.requestToPromise(request);
        return result as number; // Auto-increment primary key always returns number
      }
    );
  }

  /**
   * Get recent responses
   */
  async getRecentResponses(days: number = 30): Promise<IndexedDBResult<CardResponseRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.CARD_RESPONSES].index('timestamp');
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const range = IDBKeyRange.lowerBound(cutoff);
        const request = index.getAll(range, PERFORMANCE_CONFIG.QUERY_LIMITS.RECENT_RESPONSES);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get all card responses (for backup)
   */
  async getAllCardResponses(): Promise<IndexedDBResult<CardResponseRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.CARD_RESPONSES].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get responses for a specific card
   */
  async getCardResponses(cardId: string): Promise<IndexedDBResult<CardResponseRecord[]>> {
    // Validate cardId
    if (!cardId || typeof cardId !== 'string' || cardId.trim().length === 0) {
      return { success: true, data: [] };
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.CARD_RESPONSES].index('cardId');
        const request = index.getAll(IDBKeyRange.only(cardId));
        return await this.requestToPromise(request);
      }
    );
  }

  async getCardIdsWithMinResponses(minResponses: number): Promise<IndexedDBResult<string[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.CARD_RESPONSES].index('cardId');
        const cursor = index.openCursor();
        
        return new Promise<string[]>((resolve, reject) => {
          const cardResponseCounts = new Map<string, number>();
          
          cursor.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
              const cardId = cursor.key as string;
              cardResponseCounts.set(cardId, (cardResponseCounts.get(cardId) || 0) + 1);
              cursor.continue();
            } else {
              const cardIds = Array.from(cardResponseCounts.entries())
                .filter(([_, count]) => count >= minResponses)
                .map(([cardId, _]) => cardId);
              resolve(cardIds);
            }
          };
          cursor.onerror = () => reject(cursor.error);
        });
      }
    );
  }

  // =================== STORAGE STATS OPERATIONS ===================

  /**
   * Get storage stats
   */
  async getStorageStats(): Promise<IndexedDBResult<StorageStatsRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.STORAGE_STATS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.STORAGE_STATS].get('stats');
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Update storage stats
   */
  async updateStorageStats(stats: StorageStatsRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.STORAGE_STATS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.STORAGE_STATS].put(stats);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  // =================== MIGRATION DATA OPERATIONS ===================

  /**
   * Get migration data
   */
  async getMigrationData(key: string): Promise<IndexedDBResult<MigrationDataRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.MIGRATION_DATA], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.MIGRATION_DATA].get(key);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Set migration data
   */
  async setMigrationData(data: MigrationDataRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.MIGRATION_DATA], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.MIGRATION_DATA].put(data);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  // =================== BATCH OPERATIONS ===================

  /**
   * Batch create cards
   */
  async batchCreateCards(cards: CardRecord[]): Promise<IndexedDBResult<number>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARDS], mode: 'readwrite' },
      async (stores) => {
        let count = 0;
        const batchSize = PERFORMANCE_CONFIG.BATCH_SIZE.CARDS;
        
        for (let i = 0; i < cards.length; i += batchSize) {
          const batch = cards.slice(i, i + batchSize);
          
          for (const card of batch) {
            if (SchemaValidator.validateRecord(card, STORE_NAMES.CARDS)) {
              const request = stores[STORE_NAMES.CARDS].put(card);
              await this.requestToPromise(request);
              count++;
            }
          }
        }
        
        return count;
      }
    );
  }

  /**
   * Get count of old responses (for information only - no deletion)
   */
  async getOldResponsesCount(olderThanDays: number = 90): Promise<IndexedDBResult<number>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.CARD_RESPONSES], mode: 'readonly' },
      async (stores) => {
        const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        const index = stores[STORE_NAMES.CARD_RESPONSES].index('timestamp');
        const range = IDBKeyRange.upperBound(cutoff);
        
        let count = 0;
        const cursor = index.openCursor(range);
        
        return new Promise((resolve, reject) => {
          cursor.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              count++;
              cursor.continue();
            } else {
              resolve(count);
            }
          };
          cursor.onerror = () => reject(cursor.error);
        });
      }
    );
  }

  // =================== STATISTICS OPERATIONS ===================

  /**
   * Get or create daily statistics record
   */
  async getDailyStats(date: string): Promise<IndexedDBResult<DailyStatsRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DAILY_STATS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DAILY_STATS].get(date);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Update or create daily statistics
   */
  async setDailyStats(stats: DailyStatsRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DAILY_STATS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.DAILY_STATS].put(stats);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get daily stats within a date range for heat-map
   */
  async getDailyStatsRange(startDate: string, endDate: string): Promise<IndexedDBResult<DailyStatsRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DAILY_STATS], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.DAILY_STATS].index('date');
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);
        
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get all daily stats
   */
  async getAllDailyStats(): Promise<IndexedDBResult<DailyStatsRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DAILY_STATS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DAILY_STATS].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get recent daily stats for streak calculation
   */
  async getRecentDailyStats(days: number): Promise<IndexedDBResult<DailyStatsRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DAILY_STATS], mode: 'readonly' },
      async (stores) => {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const index = stores[STORE_NAMES.DAILY_STATS].index('timestamp');
        const range = IDBKeyRange.lowerBound(cutoff);
        const request = index.getAll(range);
        
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get streak data
   */
  async getStreakData(): Promise<IndexedDBResult<StreakDataRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.STREAK_DATA], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.STREAK_DATA].get('streaks');
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Update streak data
   */
  async setStreakData(streakData: StreakDataRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.STREAK_DATA], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.STREAK_DATA].put(streakData);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get domain blocking statistics
   */
  async getDomainBlockingStats(domain: string): Promise<IndexedDBResult<DomainBlockingStatsRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAIN_BLOCKING_STATS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAIN_BLOCKING_STATS].get(domain);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Update domain blocking statistics
   */
  async setDomainBlockingStats(stats: DomainBlockingStatsRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAIN_BLOCKING_STATS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAIN_BLOCKING_STATS].put(stats);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get all domain blocking statistics
   */
  async getAllDomainBlockingStats(): Promise<IndexedDBResult<DomainBlockingStatsRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAIN_BLOCKING_STATS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.DOMAIN_BLOCKING_STATS].getAll();
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get top domains by time saved
   */
  async getTopTimeSavingDomains(limit: number = 10): Promise<IndexedDBResult<DomainBlockingStatsRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.DOMAIN_BLOCKING_STATS], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.DOMAIN_BLOCKING_STATS].index(INDEX_NAMES.DOMAIN_BLOCKING_STATS.TIME_SAVED_AND_BLOCKS);
        const range = IDBKeyRange.lowerBound([60000, 1]); // At least 1 minute saved
        
        const results: DomainBlockingStatsRecord[] = [];
        const cursor = index.openCursor(range, 'prev'); // Descending order
        
        return new Promise((resolve, reject) => {
          cursor.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor && results.length < limit) {
              results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          cursor.onerror = () => reject(cursor.error);
        });
      }
    );
  }

  /**
   * Get tag performance statistics
   */
  async getTagPerformance(tagName: string): Promise<IndexedDBResult<TagPerformanceRecord | null>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAG_PERFORMANCE], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAG_PERFORMANCE].get(tagName);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Update tag performance statistics
   */
  async setTagPerformance(stats: TagPerformanceRecord): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAG_PERFORMANCE], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAG_PERFORMANCE].put(stats);
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get all tag performance statistics
   */
  async getAllTagPerformance(): Promise<IndexedDBResult<TagPerformanceRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAG_PERFORMANCE], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.TAG_PERFORMANCE].getAll();
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  /**
   * Get top performing tags by accuracy
   */
  async getTopPerformingTags(limit: number = 10): Promise<IndexedDBResult<TagPerformanceRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAG_PERFORMANCE], mode: 'readonly' },
      async (stores) => {
        const index = stores[STORE_NAMES.TAG_PERFORMANCE].index(INDEX_NAMES.TAG_PERFORMANCE.ACCURACY_AND_TIME);
        const range = IDBKeyRange.lowerBound([70, 0]); // 70%+ accuracy
        
        const results: TagPerformanceRecord[] = [];
        const cursor = index.openCursor(range, 'prev'); // Descending order
        
        return new Promise((resolve, reject) => {
          cursor.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor && results.length < limit) {
              results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          cursor.onerror = () => reject(cursor.error);
        });
      }
    );
  }

  /**
   * Get recent tag performance data
   */
  async getRecentTagPerformance(days: number): Promise<IndexedDBResult<TagPerformanceRecord[]>> {
    return this.executeTransaction(
      { stores: [STORE_NAMES.TAG_PERFORMANCE], mode: 'readonly' },
      async (stores) => {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const index = stores[STORE_NAMES.TAG_PERFORMANCE].index(INDEX_NAMES.TAG_PERFORMANCE.LAST_STUDIED_AND_ACCURACY);
        const range = IDBKeyRange.lowerBound([cutoff, 0]);
        const request = index.getAll(range);
        
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    );
  }

  // =================== EXPORT/IMPORT HELPERS ===================

  /**
   * Export all statistics and spaced repetition data
   */
  async exportStatisticsData(): Promise<IndexedDBResult<{
    cardResponses: CardResponseRecord[];
    storageStats: StorageStatsRecord | null;
    dailyStats: DailyStatsRecord[];
    streakData: StreakDataRecord | null;
    domainBlockingStats: DomainBlockingStatsRecord[];
  }>> {
    try {
             const [
         responsesResult,
         storageStatsResult,
         dailyStatsResult,
         streakDataResult,
         domainStatsResult
       ] = await Promise.all([
         this.getRecentResponses(3650), // Get responses from last 10 years (effectively all)
         this.getStorageStats(),
         this.getDailyStatsRange('2020-01-01', '2030-12-31'), // Wide range to get all daily stats
         this.getStreakData(),
         this.getAllDomainBlockingStats()
       ]);

      if (!responsesResult.success) {
        return { success: false, error: `Failed to export card responses: ${responsesResult.error}` };
      }
      if (!dailyStatsResult.success) {
        return { success: false, error: `Failed to export daily stats: ${dailyStatsResult.error}` };
      }
      if (!domainStatsResult.success) {
        return { success: false, error: `Failed to export domain stats: ${domainStatsResult.error}` };
      }

             const exportData = {
         cardResponses: responsesResult.data || [],
         storageStats: storageStatsResult.success ? (storageStatsResult.data || null) : null,
         dailyStats: dailyStatsResult.data || [],
         streakData: streakDataResult.success ? (streakDataResult.data || null) : null,
         domainBlockingStats: domainStatsResult.data || []
       };

      return { success: true, data: exportData };

    } catch (error) {
      return { 
        success: false, 
        error: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Import statistics and spaced repetition data
   */
  async importStatisticsData(data: {
    cardResponses?: CardResponseRecord[];
    storageStats?: StorageStatsRecord | null;
    dailyStats?: DailyStatsRecord[];
    streakData?: StreakDataRecord | null;
    domainBlockingStats?: DomainBlockingStatsRecord[];
  }): Promise<IndexedDBResult<boolean>> {
    try {
      // Clear existing data first
      await this.clearStatisticsData();

      // Import card responses
      if (data.cardResponses && data.cardResponses.length > 0) {
        for (const response of data.cardResponses) {
          const result = await this.addCardResponse(response);
          if (!result.success) {
            return { success: false, error: `Failed to import response: ${result.error}` };
          }
        }
      }

      // Import storage stats
      if (data.storageStats) {
        const result = await this.updateStorageStats(data.storageStats);
        if (!result.success) {
          return { success: false, error: `Failed to import storage stats: ${result.error}` };
        }
      }

             // Import daily stats
       if (data.dailyStats && data.dailyStats.length > 0) {
         for (const dailyStat of data.dailyStats) {
           const result = await this.setDailyStats(dailyStat);
           if (!result.success) {
             return { success: false, error: `Failed to import daily stat: ${result.error}` };
           }
         }
       }

       // Import streak data
       if (data.streakData) {
         const result = await this.setStreakData(data.streakData);
         if (!result.success) {
           return { success: false, error: `Failed to import streak data: ${result.error}` };
         }
       }

       // Import domain blocking stats
       if (data.domainBlockingStats && data.domainBlockingStats.length > 0) {
         for (const domainStat of data.domainBlockingStats) {
           const result = await this.setDomainBlockingStats(domainStat);
           if (!result.success) {
             return { success: false, error: `Failed to import domain stat: ${result.error}` };
           }
         }
       }

      return { success: true, data: true };

    } catch (error) {
      return { 
        success: false, 
        error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Clear all statistics data (used before import)
   */
  private async clearStatisticsData(): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { 
        stores: [
          STORE_NAMES.CARD_RESPONSES,
          STORE_NAMES.STORAGE_STATS,
          STORE_NAMES.DAILY_STATS,
          STORE_NAMES.STREAK_DATA,
          STORE_NAMES.DOMAIN_BLOCKING_STATS
        ], 
        mode: 'readwrite' 
      },
      async (stores) => {
        await Promise.all([
          this.requestToPromise(stores[STORE_NAMES.CARD_RESPONSES].clear()),
          this.requestToPromise(stores[STORE_NAMES.STORAGE_STATS].clear()),
          this.requestToPromise(stores[STORE_NAMES.DAILY_STATS].clear()),
          this.requestToPromise(stores[STORE_NAMES.STREAK_DATA].clear()),
          this.requestToPromise(stores[STORE_NAMES.DOMAIN_BLOCKING_STATS].clear())
        ]);
        return true;
      }
    );
  }

  /**
   * Force database reinitialization to handle schema upgrades
   */
  async reinitialize(): Promise<IndexedDBResult<void>> {
    try {
      // Close existing connection
      this.close();
      
      // Reinitialize
      const result = await this.initialize();
      if (!result.success) {
        return { success: false, error: result.error };
      }
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Database reinitialization failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Get all available snapshots
   */
  async getSnapshots(): Promise<IndexedDBResult<SnapshotRecord[]>> {
    // Check if snapshots store exists, reinitialize if not
    if (this.database && !this.database.objectStoreNames.contains(STORE_NAMES.SNAPSHOTS)) {
      console.log('Snapshots store not found, reinitializing database...');
      const reinitResult = await this.reinitialize();
      if (!reinitResult.success) {
        return { success: false, error: `Failed to reinitialize database: ${reinitResult.error}` };
      }
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.SNAPSHOTS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.SNAPSHOTS].getAll();
        const snapshots = await this.requestToPromise(request) as SnapshotRecord[];
        // Sort by timestamp descending (most recent first)
        snapshots.sort((a: SnapshotRecord, b: SnapshotRecord) => b.timestamp - a.timestamp);
        return snapshots;
      }
    );
  }

  /**
   * Store a snapshot
   */
  async setSnapshot(snapshot: SnapshotRecord): Promise<IndexedDBResult<void>> {
    // Check if snapshots store exists, reinitialize if not
    if (this.database && !this.database.objectStoreNames.contains(STORE_NAMES.SNAPSHOTS)) {
      console.log('Snapshots store not found, reinitializing database...');
      const reinitResult = await this.reinitialize();
      if (!reinitResult.success) {
        return { success: false, error: `Failed to reinitialize database: ${reinitResult.error}` };
      }
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.SNAPSHOTS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.SNAPSHOTS].put(snapshot);
        await this.requestToPromise(request);
      }
    );
  }

  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(id: string): Promise<IndexedDBResult<SnapshotRecord | null>> {
    // Check if snapshots store exists, reinitialize if not
    if (this.database && !this.database.objectStoreNames.contains(STORE_NAMES.SNAPSHOTS)) {
      console.log('Snapshots store not found, reinitializing database...');
      const reinitResult = await this.reinitialize();
      if (!reinitResult.success) {
        return { success: false, error: `Failed to reinitialize database: ${reinitResult.error}` };
      }
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.SNAPSHOTS], mode: 'readonly' },
      async (stores) => {
        const request = stores[STORE_NAMES.SNAPSHOTS].get(id);
        const snapshot = await this.requestToPromise(request) as SnapshotRecord | undefined;
        return snapshot || null;
      }
    );
  }

  /**
   * Delete a specific snapshot
   */
  async deleteSnapshot(id: string): Promise<IndexedDBResult<void>> {
    // Check if snapshots store exists, reinitialize if not
    if (this.database && !this.database.objectStoreNames.contains(STORE_NAMES.SNAPSHOTS)) {
      console.log('Snapshots store not found, reinitializing database...');
      const reinitResult = await this.reinitialize();
      if (!reinitResult.success) {
        return { success: false, error: `Failed to reinitialize database: ${reinitResult.error}` };
      }
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.SNAPSHOTS], mode: 'readwrite' },
      async (stores) => {
        const request = stores[STORE_NAMES.SNAPSHOTS].delete(id);
        await this.requestToPromise(request);
      }
    );
  }

  /**
   * Clean up old snapshots, keeping only the last N snapshots
   */
  async cleanupOldSnapshots(keepCount: number = 5): Promise<IndexedDBResult<number>> {
    // Check if snapshots store exists, reinitialize if not
    if (this.database && !this.database.objectStoreNames.contains(STORE_NAMES.SNAPSHOTS)) {
      console.log('Snapshots store not found, reinitializing database...');
      const reinitResult = await this.reinitialize();
      if (!reinitResult.success) {
        return { success: false, error: `Failed to reinitialize database: ${reinitResult.error}` };
      }
    }

    return this.executeTransaction(
      { stores: [STORE_NAMES.SNAPSHOTS], mode: 'readwrite' },
      async (stores) => {
        // Get all snapshots sorted by timestamp
        const getAllRequest = stores[STORE_NAMES.SNAPSHOTS].getAll();
        const snapshots = await this.requestToPromise(getAllRequest) as SnapshotRecord[];
        
        // Sort by timestamp descending (most recent first)
        snapshots.sort((a: SnapshotRecord, b: SnapshotRecord) => b.timestamp - a.timestamp);
        
        // Delete excess snapshots
        const snapshotsToDelete = snapshots.slice(keepCount);
        let deletedCount = 0;
        
        for (const snapshot of snapshotsToDelete) {
          const deleteRequest = stores[STORE_NAMES.SNAPSHOTS].delete(snapshot.id);
          await this.requestToPromise(deleteRequest);
          deletedCount++;
        }
        
        return deletedCount;
      }
    );
  }

  // =================== GENERIC STORE OPERATIONS ===================

  /**
   * Generic get operation for any store
   */
  async get<T>(storeName: string, key: string | number): Promise<IndexedDBResult<T | null>> {
    return this.executeTransaction(
      { stores: [storeName], mode: 'readonly' },
      async (stores) => {
        const request = stores[storeName].get(key);
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Generic put operation for any store
   */
  async put<T>(storeName: string, value: T): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [storeName], mode: 'readwrite' },
      async (stores) => {
        const request = stores[storeName].put(value);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Generic getAll operation for any store
   */
  async getAll<T>(storeName: string): Promise<IndexedDBResult<T[]>> {
    return this.executeTransaction(
      { stores: [storeName], mode: 'readonly' },
      async (stores) => {
        const request = stores[storeName].getAll();
        return await this.requestToPromise(request);
      }
    );
  }

  /**
   * Generic delete operation for any store
   */
  async delete(storeName: string, key: string | number): Promise<IndexedDBResult<boolean>> {
    return this.executeTransaction(
      { stores: [storeName], mode: 'readwrite' },
      async (stores) => {
        const request = stores[storeName].delete(key);
        await this.requestToPromise(request);
        return true;
      }
    );
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.database) {
      this.database.close();
      this.database = null;
      this.isInitialized = false;
      this.initializationPromise = null;
    }
  }
}

// Export singleton instance
export const indexedDBManager = IndexedDBManager.getInstance();
export default indexedDBManager; 