/**
 * IndexedDB Schema Design for Rekapu Extension
 * 
 * This schema replaces Chrome Sync Storage with IndexedDB for:
 * - Increased storage capacity (100MB+ vs 8MB)
 * - Better performance with indexed queries
 * - Offline data persistence
 * - Complex data structures support
 */

export interface IndexedDBSchema {
  // Database configuration
  name: string;
  version: number;
  
  // Object stores with their configurations
  stores: {
    [storeName: string]: {
      keyPath: string;
      autoIncrement?: boolean;
      indexes: {
        [indexName: string]: {
          keyPath: string | string[];
          unique?: boolean;
          multiEntry?: boolean;
        };
      };
    };
  };
}

/**
 * Rekapu IndexedDB Schema Definition
 * Version 4.0 - Added isDraft field to cards for draft functionality
 * Version 5.0 - Renamed 'cloze' card type to 'basic' for clarity
 * Version 6.0 - Added audioCache store for TTS audio caching
 * Version 7.0 - Fixed initialization race conditions and ensured all stores are properly created
 * Version 8.0 - Fixed invalid compound index with multiEntry on cards store
 * Version 9.0 - Renamed 'questions' to 'cards' throughout (breaking change for terminology consistency)
 * Version 10.0 - Removed broken cardAndTimeLegacy index, fixed migration record field names
 */
export const INDEXEDDB_SCHEMA: IndexedDBSchema = {
  name: 'RekapuDB',
  version: 10,
  
  stores: {
    
    // =================== GLOBAL SETTINGS ===================
    /**
     * Application-wide configuration and preferences
     * Single record store with fixed key 'settings'
     */
    globalSettings: {
      keyPath: 'key',
      indexes: {
        key: { keyPath: 'key', unique: true }
      }
    },
    
    // =================== DOMAINS ===================
    /**
     * Domain blocking configurations
     * Optimized for fast domain lookup and cooldown checks
     */
    domains: {
      keyPath: 'domain',
      indexes: {
        domain: { keyPath: 'domain', unique: true },
        isActive: { keyPath: 'isActive' },
        lastUnblock: { keyPath: 'lastUnblock' },
        cooldownPeriod: { keyPath: 'cooldownPeriod' },
        // Compound index for efficient blocked domain queries
        activeAndCooldown: { keyPath: ['isActive', 'lastUnblock'] }
      }
    },
    
    // =================== CARDS ===================
    /**
     * Learning cards with spaced repetition algorithm data
     * Heavily indexed for efficient spaced repetition queries
     */
    cards: {
      keyPath: 'id',
      indexes: {
        id: { keyPath: 'id', unique: true },
        created: { keyPath: 'created' },
        modified: { keyPath: 'modified' },
        type: { keyPath: 'type' },
        isDraft: { keyPath: 'isDraft' },
        
        // Spaced repetition indexes for efficient due date filtering
        dueDate: { keyPath: 'algorithm.dueDate' },
        interval: { keyPath: 'algorithm.interval' },
        ease: { keyPath: 'algorithm.ease' },
        repetitions: { keyPath: 'algorithm.repetitions' },
        
        // Compound index for spaced repetition queries
        dueDateAndInterval: { keyPath: ['algorithm.dueDate', 'algorithm.interval'] },
        
        // Draft filtering compound index for efficiency
        isDraftAndDueDate: { keyPath: ['isDraft', 'algorithm.dueDate'] },
        
        // Tag-based filtering (multiEntry for array of tags)
        tags: { keyPath: 'tags', multiEntry: true },
        
        // Performance queries
        createdAndModified: { keyPath: ['created', 'modified'] },
        typeAndDueDate: { keyPath: ['type', 'algorithm.dueDate'] }
      }
    },
    
    // =================== TAGS ===================
    /**
     * Card organization and filtering tags (SOURCE OF TRUTH for all tags)
     * Every tag string referenced in card.tags[] MUST have a corresponding TagRecord
     * Optimized for tag-based card retrieval
     */
    tags: {
      keyPath: 'id',
      indexes: {
        id: { keyPath: 'id', unique: true },
        name: { keyPath: 'name', unique: true },
        created: { keyPath: 'created' },
        color: { keyPath: 'color' },
        // Compound index for UI sorting
        nameAndCreated: { keyPath: ['name', 'created'] }
      }
    },
    
    // =================== ACTIVE TAGS ===================
    /**
     * Currently selected tags for study sessions
     * Lightweight store for active tag management
     */
    activeTags: {
      keyPath: 'id',
      indexes: {
        id: { keyPath: 'id', unique: true },
        tagName: { keyPath: 'tagName' },
        addedAt: { keyPath: 'addedAt' }
      }
    },
    
    // =================== CARD RESPONSES ===================
    /**
     * Study session responses for spaced repetition algorithm
     * Optimized for time-based queries and cleanup
     */
    cardResponses: {
      keyPath: 'id',
      autoIncrement: true,
      indexes: {
        id: { keyPath: 'id', unique: true },
        cardId: { keyPath: 'cardId' },
        timestamp: { keyPath: 'timestamp' },
        difficulty: { keyPath: 'difficulty' },
        wasCorrect: { keyPath: 'wasCorrect' },
        responseTime: { keyPath: 'responseTime' },
        
        // Compound indexes for efficient queries
        timestampAndDifficulty: { keyPath: ['timestamp', 'difficulty'] },
        
        // Cleanup and analytics queries
        timestampAndCorrect: { keyPath: ['timestamp', 'wasCorrect'] }
      }
    },
    
    // =================== STORAGE STATS ===================
    /**
     * Storage usage statistics and metadata
     * Single record store with fixed key 'stats'
     */
    storageStats: {
      keyPath: 'key',
      indexes: {
        key: { keyPath: 'key', unique: true },
        lastUpdated: { keyPath: 'lastUpdated' },
        lastCleanup: { keyPath: 'lastCleanup' }
      }
    },
    
    // =================== MIGRATION METADATA ===================
    /**
     * Migration tracking and version control
     * Tracks migration from Chrome Sync Storage and future schema updates
     */
    migrationData: {
      keyPath: 'key',
      indexes: {
        key: { keyPath: 'key', unique: true },
        migrationVersion: { keyPath: 'migrationVersion' },
        migrationDate: { keyPath: 'migrationDate' },
        sourceVersion: { keyPath: 'sourceVersion' }
      }
    },
    
    // =================== DAILY STATISTICS ===================
    /**
     * Daily activity statistics for heat-map visualization
     * One record per day with aggregated metrics
     */
    dailyStats: {
      keyPath: 'date',
      indexes: {
        date: { keyPath: 'date', unique: true },  // Format: YYYY-MM-DD
        timestamp: { keyPath: 'timestamp' },
        cardsAnswered: { keyPath: 'cardsAnswered' },
        correctAnswers: { keyPath: 'correctAnswers' },
        totalStudyTime: { keyPath: 'totalStudyTime' },
        // Compound indexes for efficient range queries
        timestampAndCards: { keyPath: ['timestamp', 'cardsAnswered'] },
        dateAndActivity: { keyPath: ['date', 'cardsAnswered'] }
      }
    },
    
    // =================== STUDY STREAKS ===================
    /**
     * Streak tracking and statistics
     * Single record store with current and historical streak data
     */
    streakData: {
      keyPath: 'key',
      indexes: {
        key: { keyPath: 'key', unique: true },  // Fixed key: 'streaks'
        lastUpdated: { keyPath: 'lastUpdated' },
        currentStreak: { keyPath: 'currentStreak' },
        bestStreak: { keyPath: 'bestStreak' }
      }
    },
    
    // =================== DOMAIN BLOCKING STATS ===================
    /**
     * Domain blocking statistics and time-saved metrics
     * One record per domain with blocking analytics
     */
    domainBlockingStats: {
      keyPath: 'domain',
      indexes: {
        domain: { keyPath: 'domain', unique: true },
        totalBlockCount: { keyPath: 'totalBlockCount' },
        totalTimeSaved: { keyPath: 'totalTimeSaved' },  // milliseconds
        lastBlocked: { keyPath: 'lastBlocked' },
        firstBlocked: { keyPath: 'firstBlocked' },
        // Compound indexes for analytics
        timeSavedAndBlocks: { keyPath: ['totalTimeSaved', 'totalBlockCount'] },
        lastBlockedAndCount: { keyPath: ['lastBlocked', 'totalBlockCount'] }
      }
    },
    
    // =================== TAG PERFORMANCE ===================
    /**
     * Performance analytics by card tags
     * Aggregated statistics for each tag
     */
    tagPerformance: {
      keyPath: 'tagName',
      indexes: {
        tagName: { keyPath: 'tagName', unique: true },
        totalCards: { keyPath: 'totalCards' },
        averageAccuracy: { keyPath: 'averageAccuracy' },
        averageResponseTime: { keyPath: 'averageResponseTime' },
        lastStudied: { keyPath: 'lastStudied' },
        // Compound indexes for performance analysis
        accuracyAndTime: { keyPath: ['averageAccuracy', 'averageResponseTime'] },
        lastStudiedAndAccuracy: { keyPath: ['lastStudied', 'averageAccuracy'] }
      }
    },
    
    // =================== SNAPSHOTS ===================
    /**
     * Data snapshots for rollback functionality
     * Stores complete data state for recovery
     */
    snapshots: {
      keyPath: 'id',
      indexes: {
        id: { keyPath: 'id', unique: true },
        timestamp: { keyPath: 'timestamp' }
      }
    },
    
    // =================== AUDIO CACHE ===================
    /**
     * TTS audio cache for improved performance and cost reduction
     * Stores synthesized audio with LRU eviction strategy
     */
    audioCache: {
      keyPath: 'hash',
      indexes: {
        hash: { keyPath: 'hash', unique: true },  // SHA-256 hash of text+language+voice
        createdAt: { keyPath: 'createdAt' },
        lastAccessedAt: { keyPath: 'lastAccessedAt' },
        accessCount: { keyPath: 'accessCount' },
        provider: { keyPath: 'provider' },
        sizeBytes: { keyPath: 'sizeBytes' },
        // Compound indexes for LRU eviction and cache management
        lastAccessedAndCount: { keyPath: ['lastAccessedAt', 'accessCount'] },
        providerAndAccessed: { keyPath: ['provider', 'lastAccessedAt'] }
      }
    },

    // =================== MEDIA FILES ===================
    /**
     * Media files from Anki .apkg imports (images, audio, video)
     * Stored as Blobs with deduplication via content hash
     */
    media: {
      keyPath: 'id',
      indexes: {
        id: { keyPath: 'id', unique: true },
        hash: { keyPath: 'hash', unique: false },
        originalName: { keyPath: 'originalName', unique: false },
        createdAt: { keyPath: 'createdAt' },
        mimeType: { keyPath: 'mimeType' }
      }
    }
  }
};

/**
 * Data type definitions for IndexedDB stores
 */

// Global Settings Store Record
export interface GlobalSettingsRecord {
  key: 'settings';
  data: {
    defaultCooldownPeriod: number;
    maxCardsPerSession: number;
    theme: 'light' | 'dark';
    dailyGoal: number;  // minimum quality cards per day for streak
    weekStartsOnMonday: boolean;  // true = Monday-Sunday, false = Sunday-Saturday
    autoAdvanceDelay: number;
    backupScope: 'cards' | 'full';
  };
  lastUpdated: number;
}

// Domain Store Record
export interface DomainRecord {
  domain: string;
  cooldownPeriod: number;
  isActive: boolean;
  lastUnblock: number;
  subdomainsIncluded: boolean;
  created: number;
  modified: number;
}

// Card Store Record
export interface CardRecord {
  id: string;
  type: 'basic' | 'cloze';
  front: string;
  back: string;
  tags: string[]; // Array of tag names that reference TagRecord.name
  created: number;
  modified: number;
  isDraft: boolean;
  algorithm: {
    interval: number;
    ease: number;
    repetitions: number;
    dueDate: number;
  };
  // Future extensibility
  media?: {
    images?: string[];
    audio?: string[];
    video?: string[];
  };
  metadata?: {
    difficulty?: number;
    source?: string;
    author?: string;
  };
  // Cloze-specific fields
  clozeSource?: string; // Original text with cloze markers
  clozeDeletions?: Array<{
    id: number; // c1, c2, etc.
    text: string; // The text to be hidden
    hint?: string; // Optional hint
    algorithm: {
      dueDate: number;
      interval: number;
      ease: number;
      repetitions: number;
    };
  }>;
}

// Backward compatibility
// Backward compatibility type aliases
export type QuestionRecord = CardRecord;

// Tag Store Record
export interface TagRecord {
  id: string;
  name: string;
  color: string;
  created: number;
  description?: string;
  icon?: string;
}

// Active Tags Store Record
export interface ActiveTagRecord {
  id: string;
  tagName: string;
  addedAt: number;
}

// Card Response Store Record
export interface CardResponseRecord {
  id?: number; // Auto-generated
  cardId: string;
  timestamp: number;
  difficulty: 'again' | 'hard' | 'good' | 'easy';
  responseTime: number;
  wasCorrect: boolean;
  // Future extensibility
  sessionId?: string;
  deviceId?: string;
  studyMode?: string;
}

// Backward compatibility
// Backward compatibility type alias
export type QuestionResponseRecord = CardResponseRecord;

// Storage Stats Store Record
export interface StorageStatsRecord {
  key: 'stats';
  data: {
    totalCards: number;
    totalDomains: number;
    totalResponses: number;
    totalTags: number;
    storageUsed: number;
    lastCleanup: number;
  };
  lastUpdated: number;
}

// Migration Data Store Record
export interface MigrationDataRecord {
  key: string;
  migrationVersion: string;
  migrationDate: number;
  sourceVersion: string;
  migratedRecords: {
    globalSettings: number;
    domains: number;
    cards: number;
    tags: number;
    activeTags: number;
    cardResponses: number;
    storageStats: number;
  };
  migrationLog: string[];
  isComplete: boolean;
}

// Daily Statistics Store Record
export interface DailyStatsRecord {
  date: string;  // Format: YYYY-MM-DD
  timestamp: number;  // Start of day timestamp
  cardsAnswered: number;
  correctAnswers: number;
  totalStudyTime: number;  // milliseconds
  domainsBlocked: number;
  timeSaved: number;  // milliseconds saved by blocking
  studySessions: number;  // Number of separate study sessions
  streakContribution: boolean;  // Whether this day counts toward streak (cardsAnswered >= dailyGoal)
  tagBreakdown: {
    [tagName: string]: {
      cardsAnswered: number;
      correctAnswers: number;
      studyTime: number;
    };
  };
}

// Streak Data Store Record
export interface StreakDataRecord {
  key: 'streaks';
  currentStreak: number;  // Current consecutive days with activity
  bestStreak: number;    // All-time best streak
  currentStreakStart: number;  // Timestamp when current streak started
  bestStreakPeriod: {
    start: number;  // Timestamp when best streak started
    end: number;    // Timestamp when best streak ended
  };
  lastActivity: number;  // Timestamp of last qualifying activity
  minimumCards: number;  // Min cards per day to maintain streak
  totalActiveDays: number;   // Total days with any activity
  weeklyStats: {
    [weekKey: string]: {  // Format: YYYY-WW
      activeDays: number;
      totalCards: number;
      averageAccuracy: number;
    };
  };
  lastUpdated: number;
}

// Domain Blocking Stats Store Record
export interface DomainBlockingStatsRecord {
  domain: string;
  totalBlockCount: number;
  totalTimeSaved: number;  // Total milliseconds saved
  averageBlockDuration: number;  // Average time between blocks
  lastBlocked: number;  // Timestamp of last block event
  firstBlocked: number;  // Timestamp of first block event
  dailyBreakdown: {
    [date: string]: {  // Format: YYYY-MM-DD
      blockCount: number;
      timeSaved: number;
      lastAccess: number;
    };
  };
  peakUsageHours: number[];  // Hours of day with most blocks (0-23)
  categoryTags: string[];    // Associated card tags when blocked
}

// Tag Performance Store Record
export interface TagPerformanceRecord {
  tagName: string;
  totalCards: number;
  totalAnswered: number;
  correctAnswers: number;
  averageAccuracy: number;  // Percentage 0-100
  averageResponseTime: number;  // milliseconds
  totalStudyTime: number;  // Total time spent on this tag
  lastStudied: number;  // Timestamp of last study session
  firstStudied: number;  // Timestamp of first study session
  difficultyDistribution: {
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  weeklyProgress: {
    [weekKey: string]: {  // Format: YYYY-WW
      cardsAnswered: number;
      accuracy: number;
      studyTime: number;
    };
  };
  easeFactor: {
    average: number;
    range: { min: number; max: number; };
  };
}

// Snapshot Store Record
export interface SnapshotRecord {
  id: string;
  timestamp: number;
  cards: Record<string, any>;
  tags: Record<string, any>;
  domains: Record<string, any>;
  globalSettings: any;
  statisticsData?: any;
}

// Audio Cache Store Record
export interface AudioCacheRecord {
  hash: string;                  // SHA-256 hash of text+language+voice+provider
  audioData: ArrayBuffer;        // Binary audio data
  text: string;                  // Original text for reference
  language: string;              // Language code (e.g., 'en-US')
  voice: string;                 // Voice identifier (e.g., 'en-US-Neural2-A')
  provider: string;              // TTS provider name (e.g., 'google', 'openai', 'elevenlabs')
  createdAt: number;             // Timestamp when cached
  lastAccessedAt: number;        // Timestamp of last access
  accessCount: number;           // Number of times accessed
  sizeBytes: number;             // Size of audio data in bytes
}

/**
 * Store names as constants for type safety
 */
export const STORE_NAMES = {
  GLOBAL_SETTINGS: 'globalSettings',
  DOMAINS: 'domains',
  CARDS: 'cards',
  TAGS: 'tags',
  ACTIVE_TAGS: 'activeTags',
  CARD_RESPONSES: 'cardResponses',
  STORAGE_STATS: 'storageStats',
  MIGRATION_DATA: 'migrationData',
  DAILY_STATS: 'dailyStats',
  STREAK_DATA: 'streakData',
  DOMAIN_BLOCKING_STATS: 'domainBlockingStats',
  TAG_PERFORMANCE: 'tagPerformance',
  SNAPSHOTS: 'snapshots',
  AUDIO_CACHE: 'audioCache',
  MEDIA: 'media'
} as const;

/**
 * Index names for efficient queries
 */
export const INDEX_NAMES = {
  CARDS: {
    DUE_DATE: 'dueDate',
    TAGS: 'tags',
    DUE_DATE_AND_INTERVAL: 'dueDateAndInterval',
    TYPE_AND_DUE_DATE: 'typeAndDueDate'
  },
  DOMAINS: {
    ACTIVE_AND_COOLDOWN: 'activeAndCooldown',
    IS_ACTIVE: 'isActive'
  },
  CARD_RESPONSES: {
    TIMESTAMP_AND_DIFFICULTY: 'timestampAndDifficulty'
  },
  DAILY_STATS: {
    TIMESTAMP_AND_CARDS: 'timestampAndCards',
    DATE_AND_ACTIVITY: 'dateAndActivity'
  },
  DOMAIN_BLOCKING_STATS: {
    TIME_SAVED_AND_BLOCKS: 'timeSavedAndBlocks',
    LAST_BLOCKED_AND_COUNT: 'lastBlockedAndCount'
  },
  TAG_PERFORMANCE: {
    ACCURACY_AND_TIME: 'accuracyAndTime',
    LAST_STUDIED_AND_ACCURACY: 'lastStudiedAndAccuracy'
  }
} as const;

/**
 * Common queries for spaced repetition
 */
export const COMMON_QUERIES = {
  // Get due cards for study session
  getDueCards: () => ({
    store: STORE_NAMES.CARDS,
    index: INDEX_NAMES.CARDS.DUE_DATE,
    range: IDBKeyRange.upperBound(Date.now())
  }),
  
  // Get cards by tag
  getCardsByTag: (tagName: string) => ({
    store: STORE_NAMES.CARDS,
    index: INDEX_NAMES.CARDS.TAGS,
    range: IDBKeyRange.only(tagName)
  }),
  
  // Get active domains
  getActiveDomains: () => ({
    store: STORE_NAMES.DOMAINS,
    index: INDEX_NAMES.DOMAINS.IS_ACTIVE,
    range: IDBKeyRange.only(true)
  }),
  
  // Get recent responses for analytics
  getRecentResponses: (days: number) => ({
    store: STORE_NAMES.CARD_RESPONSES,
    index: 'timestamp',
    range: IDBKeyRange.lowerBound(Date.now() - (days * 24 * 60 * 60 * 1000))
  }),
  
  // Get daily stats for heat-map generation
  getDailyStatsRange: (startDate: string, endDate: string) => ({
    store: STORE_NAMES.DAILY_STATS,
    index: INDEX_NAMES.DAILY_STATS.DATE_AND_ACTIVITY,
    range: IDBKeyRange.bound([startDate, 0], [endDate, Number.MAX_SAFE_INTEGER])
  }),
  
  // Get recent daily stats for streak calculation
  getRecentDailyStats: (days: number) => ({
    store: STORE_NAMES.DAILY_STATS,
    index: 'timestamp',
    range: IDBKeyRange.lowerBound(Date.now() - (days * 24 * 60 * 60 * 1000))
  }),
  
  // Get top performing tags
  getTopPerformingTags: () => ({
    store: STORE_NAMES.TAG_PERFORMANCE,
    index: INDEX_NAMES.TAG_PERFORMANCE.ACCURACY_AND_TIME,
    range: IDBKeyRange.lowerBound([70, 0])  // 70%+ accuracy
  }),
  
  // Get domain blocking stats ordered by time saved
  getTopTimeSavingDomains: () => ({
    store: STORE_NAMES.DOMAIN_BLOCKING_STATS,
    index: INDEX_NAMES.DOMAIN_BLOCKING_STATS.TIME_SAVED_AND_BLOCKS,
    range: IDBKeyRange.lowerBound([60000, 1])  // At least 1 minute saved
  }),
  
  // Get recent tag performance data
  getRecentTagPerformance: (days: number) => ({
    store: STORE_NAMES.TAG_PERFORMANCE,
    index: INDEX_NAMES.TAG_PERFORMANCE.LAST_STUDIED_AND_ACCURACY,
    range: IDBKeyRange.lowerBound([Date.now() - (days * 24 * 60 * 60 * 1000), 0])
  })
};

/**
 * Schema validation utilities
 */
export const SchemaValidator = {
  /**
   * Validate that a record conforms to the expected structure
   */
  validateRecord<T>(record: T, storeName: string): boolean {
    // Basic validation - in real implementation, would use a schema validator
    if (!record || typeof record !== 'object') return false;
    
    // Store-specific validation
    switch (storeName) {
      case STORE_NAMES.CARDS:
        const card = record as unknown as CardRecord;
        return !!(card.id && card.type && card.front && card.back);
      
      case STORE_NAMES.DOMAINS:
        const domain = record as unknown as DomainRecord;
        return !!(domain.domain && typeof domain.isActive === 'boolean');
      
      default:
        return true;
    }
  },
  
  /**
   * Validate schema compatibility
   */
  validateSchemaCompatibility(existingVersion: number, newVersion: number): boolean {
    return newVersion >= existingVersion;
  }
};

/**
 * Performance optimization constants
 */
export const PERFORMANCE_CONFIG = {
  // Transaction batch sizes
  BATCH_SIZE: {
    CARDS: 50,
    RESPONSES: 100,
    DOMAINS: 20,
    TAGS: 30
  },
  
  // Query limits
  QUERY_LIMITS: {
    DUE_CARDS: 100,
    RECENT_RESPONSES: 500,
    SEARCH_RESULTS: 50,
    CARDS_PER_PAGE: 25
  },
  
  // Storage limits (no automatic cleanup)
  STORAGE_LIMITS: {
    WARNING_THRESHOLD_PERCENTAGE: 80,
    CRITICAL_THRESHOLD_PERCENTAGE: 90,
    FULL_THRESHOLD_PERCENTAGE: 95
  },
  
  // Performance monitoring
  PERFORMANCE_MONITORING: {
    SLOW_QUERY_THRESHOLD_MS: 100,
    TRANSACTION_TIMEOUT_MS: 30000,
    MAX_CONCURRENT_TRANSACTIONS: 5
  },
  
  // Storage quotas and limits
  STORAGE_QUOTAS: {
    // Fallback value if browser storage API fails (actual quota is queried dynamically)
    FALLBACK_QUOTA_MB: 1000,
    ESTIMATED_RECORD_SIZES: {
      CARD: 2000,      // ~2KB per card
      DOMAIN: 200,         // ~200B per domain
      RESPONSE: 100,       // ~100B per response
      TAG: 150,            // ~150B per tag
      ACTIVE_TAG: 50       // ~50B per active tag
    }
  }
};

export default INDEXEDDB_SCHEMA; 