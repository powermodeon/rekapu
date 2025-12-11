// Storage data models for Rekapu Chrome Extension
// Used for IndexedDB storage with high capacity and efficient indexed queries

import { 
  DomainSettings as BaseDomainSettings,
  Card as BaseCard,
  StudySession,
  AppSettings,
  Tag,
  CardType 
} from './index';

// Re-export base types for storage compatibility
export type DomainSettings = BaseDomainSettings;
export type Card = BaseCard;
export type CardResponse = StudySession; // StudySession is the same as CardResponse

// Backward compatibility
export type Question = Card;
export type QuestionResponse = CardResponse;

/**
 * Backup scope options for export/import operations
 */
export type BackupScope = 'cards' | 'full';

/**
 * Enhanced global settings extending base AppSettings with storage-specific options
 */
export interface GlobalSettings extends AppSettings {
  autoAdvanceDelay: number; // milliseconds before auto-advancing
  backupScope: BackupScope; // default scope for backup operations
}

/**
 * Storage usage statistics for IndexedDB
 */
export interface StorageStats {
  totalCards: number;
  totalDomains: number;
  storageUsed: number; // bytes
  lastCleanup: number; // timestamp
}

/**
 * Complete storage data structure for IndexedDB
 * Organized for efficient storage and retrieval in IndexedDB object stores
 */
export interface StorageData {
  // Settings
  globalSettings: GlobalSettings;
  
  // Domain management (key: "domains")
  domains: Record<string, DomainSettings>;
  
  // Cards (key: "cards") 
  cards: Record<string, Card>;

  // Tags for card organization (key: "tags")
  tags: Record<string, Tag>;
  
  // Active tags for study sessions (key: "activeTags")
  activeTags: string[];
  
  // Recent responses for algorithm updates (key: "responses")
  recentResponses: CardResponse[];
  
  // Storage metadata (key: "stats")
  stats: StorageStats;
}

/**
 * Default values for new installations
 */
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  defaultCooldownPeriod: 10,
  maxCardsPerSession: 5,
  theme: 'dark' as const,
  dailyGoal: 1,
  weekStartsOnMonday: true,
  autoAdvanceDelay: 2000,
  backupScope: 'cards',
};

export const DEFAULT_DOMAIN_SETTINGS: Omit<DomainSettings, 'domain'> = {
  cooldownPeriod: 2,
  isActive: true,
  lastUnblock: 0,
  subdomainsIncluded: true,
  created: Date.now(),
  modified: Date.now(),
};

export const DEFAULT_SPACED_REPETITION = {
  interval: 1,
  ease: 2.5,
  repetitions: 0,
  dueDate: Date.now(),
};

/**
 * Storage keys for IndexedDB object stores
 */
export const STORAGE_KEYS = {
  GLOBAL_SETTINGS: 'globalSettings',
  DOMAINS: 'domains',
  CARDS: 'cards',
  TAGS: 'tags',
  ACTIVE_TAGS: 'activeTags',
  RESPONSES: 'responses',
  STATS: 'stats',
} as const; 

/**
 * Import/Export Types
 */
export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

export interface ImportReport {
  success: boolean;
  summary: {
    cardsImported: number;
    cardsSkipped: number;
    cardsRenamed: number;
    tagsImported: number;
    domainsImported: number;
    settingsImported: boolean;
    statisticsImported: boolean;
  };
  conflicts: Array<{
    type: 'card' | 'tag' | 'domain' | 'settings';
    id: string;
    action: 'overwrite' | 'rename' | 'skip';
    newId?: string;
    description?: string;
  }>;
  errors: string[];
  conflictDetection?: {
    hasConflicts: boolean;
    totalConflicts: number;
    conflictsByType: Record<string, number>;
  };
}

export interface StatisticsData {
  dailyStats: Array<any>;
  streakData: any | null;
  domainBlockingStats: Array<any>;
  tagPerformance: Array<any>;
  cardResponses: Array<any>;
}

export interface TagWithOptionalFields extends Tag {
  description?: string;
  icon?: string;
}

export interface BackupData {
  version: string;
  timestamp: number;
  scope: BackupScope;
  data: {
    cards?: Record<string, Card>;
    tags?: Record<string, TagWithOptionalFields>;
    activeTags?: string[];
    domains?: Record<string, DomainSettings>;
    globalSettings?: GlobalSettings;
    statistics?: StatisticsData;
  };
} 