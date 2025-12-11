import JSZip from 'jszip';
import { StorageManager } from './StorageManager';
import { indexedDBManager } from './IndexedDBManager';
import { ConflictResolver, DataConflict, ConflictDetectionResult } from './ConflictResolver';
import { ImportTransaction, ValidationResult } from './ImportTransaction';
import { 
  BackupScope, 
  BackupData, 
  ImportReport, 
  ConflictStrategy,
  GlobalSettings,
  DomainSettings,
  Card
} from '../types/storage';
import { Tag } from '../types/index';
import { AnkiImporter } from '../utils/ankiImporter';

/**
 * BackupManager handles export and import of application data
 * Supports both cards-only and full backup scopes
 */
export class BackupManager {
  private static readonly BACKUP_VERSION = '2.0.0';
  private static readonly BACKUP_FILENAME = 'rekapu-backup.json';

  /**
   * Export backup data as a ZIP blob
   */
  static async exportBackup(scope: BackupScope): Promise<Blob> {
    try {
      const backupData = await this.collectBackupData(scope);
      const zip = new JSZip();
      
      // Add main backup data
      zip.file(this.BACKUP_FILENAME, JSON.stringify(backupData, null, 2));
      
      // Add metadata file
      const metadata = {
        version: this.BACKUP_VERSION,
        scope,
        timestamp: backupData.timestamp,
        filename: this.BACKUP_FILENAME
      };
      zip.file('backup-info.json', JSON.stringify(metadata, null, 2));
      
      // Generate ZIP blob
      return await zip.generateAsync({ type: 'blob' });
      
    } catch (error) {
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect conflicts before importing backup data
   */
  static async detectImportConflicts(
    file: File,
    mode: BackupScope
  ): Promise<ConflictDetectionResult & { backupData: BackupData }> {
    try {
      // Extract and parse backup data
      const backupData = await this.extractBackupData(file);
      
      if (!backupData) {
        throw new Error('Invalid backup file format');
      }

      // Get existing data for comparison
      const existingData = {
        cards: undefined as Record<string, Card> | undefined,
        tags: undefined as Record<string, Tag> | undefined,
        domains: undefined as Record<string, DomainSettings> | undefined,
        globalSettings: undefined as GlobalSettings | undefined
      };

      // Load existing data based on what's being imported
      if (mode === 'cards' || backupData.scope === 'cards') {
        const cardsResult = await StorageManager.getAllCards();
        if (cardsResult.success) {
          existingData.cards = cardsResult.data;
        }

        const tagsResult = await StorageManager.getAllTags();
        if (tagsResult.success) {
          existingData.tags = tagsResult.data;
        }
      } else {
        // Full import - load all data
        const [cardsResult, tagsResult, domainsResult, settingsResult] = await Promise.all([
          StorageManager.getAllCards(),
          StorageManager.getAllTags(),
          StorageManager.getAllDomains(),
          StorageManager.getGlobalSettings()
        ]);

        if (cardsResult.success) {
          existingData.cards = cardsResult.data;
        }
        if (tagsResult.success) {
          existingData.tags = tagsResult.data;
        }
        if (domainsResult.success) {
          // Convert domains array to record format if needed
          const domainsRecord: Record<string, DomainSettings> = {};
          if (domainsResult.data) {
            Object.values(domainsResult.data).forEach((domain: DomainSettings) => {
              domainsRecord[domain.domain] = domain;
            });
          }
          existingData.domains = domainsRecord;
        }
        if (settingsResult.success) {
          existingData.globalSettings = settingsResult.data;
        }
      }

      // Detect conflicts
      const conflictResult = ConflictResolver.detectAllConflicts(backupData.data, existingData);

      return {
        ...conflictResult,
        backupData
      };

    } catch (error) {
      throw new Error(`Failed to detect conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import backup data with pre-resolved conflicts (with transaction rollback support)
   */
  static async importBackupWithConflictResolution(
    backupData: BackupData,
    mode: BackupScope,
    conflicts: DataConflict[],
    resolutions: Array<{ conflictId: string; action: ConflictStrategy; newId?: string }>
  ): Promise<ImportReport & { snapshotId?: string }> {
    const report: ImportReport = {
      success: false,
      summary: {
        cardsImported: 0,
        cardsSkipped: 0,
        cardsRenamed: 0,
        tagsImported: 0,
        domainsImported: 0,
        settingsImported: false,
        statisticsImported: false
      },
      conflicts: [],
      errors: [],
      conflictDetection: {
        hasConflicts: conflicts.length > 0,
        totalConflicts: conflicts.length,
        conflictsByType: this.groupConflictsByType(conflicts)
      }
    };

    try {
      // Execute import within a transaction for rollback capability
      const transaction = new ImportTransaction();
      
      const { result: importResult, snapshotId } = await transaction.execute(async () => {
        // Apply conflict resolutions to backup data
        const conflictResolutions = resolutions.map(r => ({
          conflictId: r.conflictId,
          action: r.action,
          newId: r.newId
        }));

        const { processedData, skippedItems, renamedItems } = ConflictResolver.applyConflictResolutions(
          backupData.data,
          conflictResolutions
        );

        // Update report with resolution actions
        for (const resolution of resolutions) {
          const conflict = conflicts.find(c => c.id === resolution.conflictId);
          if (conflict) {
            report.conflicts.push({
              type: conflict.type,
              id: conflict.id,
              action: resolution.action,
              newId: resolution.newId,
              description: ConflictResolver.getConflictDescription(conflict)
            });
          }
        }

        // Import processed data
        if (mode === 'cards' || backupData.scope === 'cards') {
          await this.importProcessedCards(processedData.cards || {}, report);
          await this.importProcessedTags(processedData.tags || {}, report);
          // Import active tags
          if (backupData.data.activeTags) {
            await this.importActiveTags(backupData.data.activeTags);
          }
        } else {
          // Full import
          await this.importProcessedCards(processedData.cards || {}, report);
          await this.importProcessedTags(processedData.tags || {}, report);
          await this.importProcessedDomains(processedData.domains || {}, report);
          if (processedData.globalSettings) {
            await this.importProcessedSettings(processedData.globalSettings, report);
          }
          // Import active tags
          if (backupData.data.activeTags) {
            await this.importActiveTags(backupData.data.activeTags);
          }
          // Import statistics data
          if (backupData.data.statistics) {
            await this.importStatistics(backupData.data.statistics, report);
          }
        }

        // Update summary with skipped and renamed items
        report.summary.cardsSkipped += skippedItems.filter(id => 
          processedData.cards && processedData.cards[id]
        ).length;

        for (const renamed of renamedItems) {
          if (renamed.type === 'card') {
            report.summary.cardsRenamed++;
          }
        }

        // Check for any import errors
        if (report.errors.length > 0) {
          throw new Error(`Import errors occurred: ${report.errors.join(', ')}`);
        }

        return report;
      }, true); // Enable validation after import

      report.success = true;
      return { ...importResult, snapshotId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      report.errors.push(`Import failed: ${errorMessage}`);
      report.success = false;
      return report;
    }
  }

  /**
   * Import backup data from a file (legacy method with automatic conflict resolution)
   */
  static async importBackup(
    file: File, 
    mode: BackupScope, 
    strategy: ConflictStrategy
  ): Promise<ImportReport> {
    try {
      // Detect conflicts first
      const conflictDetection = await this.detectImportConflicts(file, mode);
      
      if (conflictDetection.hasConflicts) {
        // Auto-resolve conflicts using the provided strategy
        const resolutions = conflictDetection.conflicts.map(conflict => ({
          conflictId: conflict.id,
          action: strategy,
          newId: strategy === 'rename' ? 
            ConflictResolver.generateUniqueId(conflict.id, new Set(), conflict.type as any) : 
            undefined
        }));

        return await this.importBackupWithConflictResolution(
          conflictDetection.backupData,
          mode,
          conflictDetection.conflicts,
          resolutions
        );
      } else {
        // No conflicts, proceed with direct import
        return await this.importBackupWithConflictResolution(
          conflictDetection.backupData,
          mode,
          [],
          []
        );
      }

    } catch (error) {
      return {
        success: false,
        summary: {
          cardsImported: 0,
          cardsSkipped: 0,
          cardsRenamed: 0,
          tagsImported: 0,
          domainsImported: 0,
          settingsImported: false,
          statisticsImported: false
        },
        conflicts: [],
        errors: [`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Import Anki .txt file (plain text export with tab-separated values)
   * Converts Anki format to BackupData and reuses all existing import infrastructure
   * @param file - The Anki .txt file to import
   * @param strategy - Conflict resolution strategy
   * @param additionalTags - Optional tags to add to all imported cards
   */
  static async importAnki(
    file: File,
    strategy: ConflictStrategy = 'rename',
    additionalTags: string[] = []
  ): Promise<ImportReport> {
    try {
      // Parse Anki .txt file with additional tags
      const parseResult = await AnkiImporter.parse(file, additionalTags);
      
      // Check for parse errors (including HTML rejection)
      if (!parseResult.success) {
        return {
          success: false,
          summary: {
            cardsImported: 0,
            cardsSkipped: 0,
            cardsRenamed: 0,
            tagsImported: 0,
            domainsImported: 0,
            settingsImported: false,
            statisticsImported: false
          },
          conflicts: [],
          errors: parseResult.errors.length > 0 ? parseResult.errors : ['Failed to parse Anki file']
        };
      }

      // Get backupData from parse result
      const backupData = parseResult.backupData!;

      // Get existing data for conflict detection
      const existingData = {
        cards: undefined as Record<string, Card> | undefined,
        tags: undefined as Record<string, Tag> | undefined,
        domains: undefined as Record<string, DomainSettings> | undefined,
        globalSettings: undefined as GlobalSettings | undefined
      };

      // Load existing cards and tags
      const cardsResult = await StorageManager.getAllCards();
      if (cardsResult.success) {
        existingData.cards = cardsResult.data;
      }

      const tagsResult = await StorageManager.getAllTags();
      if (tagsResult.success) {
        existingData.tags = tagsResult.data;
      }

      // Detect conflicts
      const conflictResult = ConflictResolver.detectAllConflicts(backupData.data, existingData);

      // Auto-resolve conflicts using the provided strategy
      if (conflictResult.hasConflicts) {
        const resolutions = conflictResult.conflicts.map(conflict => ({
          conflictId: conflict.id,
          action: strategy,
          newId: strategy === 'rename' ? 
            ConflictResolver.generateUniqueId(conflict.id, new Set(), conflict.type as any) : 
            undefined
        }));

        return await this.importBackupWithConflictResolution(
          backupData,
          'cards', // Anki imports are always cards-only
          conflictResult.conflicts,
          resolutions
        );
      } else {
        // No conflicts, proceed with direct import
        return await this.importBackupWithConflictResolution(
          backupData,
          'cards',
          [],
          []
        );
      }

    } catch (error) {
      return {
        success: false,
        summary: {
          cardsImported: 0,
          cardsSkipped: 0,
          cardsRenamed: 0,
          tagsImported: 0,
          domainsImported: 0,
          settingsImported: false,
          statisticsImported: false
        },
        conflicts: [],
        errors: [`Anki import failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Fast batch import for new cards with snapshot creation
   * Use when importing large datasets where all cards are new
   */
  static async importCardsBatch(
    backupData: BackupData
  ): Promise<ImportReport> {
    const report: ImportReport = {
      success: false,
      summary: {
        cardsImported: 0,
        cardsSkipped: 0,
        cardsRenamed: 0,
        tagsImported: 0,
        domainsImported: 0,
        settingsImported: false,
        statisticsImported: false
      },
      conflicts: [],
      errors: []
    };

    try {
      // Create snapshot before import for rollback capability
      const transaction = new ImportTransaction();
      await (transaction as any).createSnapshot();
      await (transaction as any).persistSnapshot();

      // Import tags first (batch)
      if (backupData.data.tags) {
        const tagRecords = Object.values(backupData.data.tags).map(tag => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          created: tag.created
        }));
        
        const tagsResult = await indexedDBManager.setTagsBatch(tagRecords);
        if (tagsResult.success) {
          report.summary.tagsImported = tagsResult.data || 0;
        } else {
          report.errors.push(`Failed to import tags: ${tagsResult.error}`);
        }
      }

      // Import cards (batch)
      if (backupData.data.cards) {
        const cardRecords = Object.values(backupData.data.cards);
        const cardsResult = await indexedDBManager.setCardsBatch(cardRecords);
        if (cardsResult.success) {
          report.summary.cardsImported = cardsResult.data || 0;
        } else {
          report.errors.push(`Failed to import cards: ${cardsResult.error}`);
        }
      }

      report.success = report.errors.length === 0;
      return report;

    } catch (error) {
      report.errors.push(`Batch import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return report;
    }
  }

  /**
   * Collect backup data based on scope
   */
  private static async collectBackupData(scope: BackupScope): Promise<BackupData> {
    const timestamp = Date.now();
    
    const backupData: BackupData = {
      version: this.BACKUP_VERSION,
      timestamp,
      scope,
      data: {}
    };

    // Always include cards, tags, and active tags
    const cardsResult = await StorageManager.getAllCards();
    if (cardsResult.success) {
      backupData.data.cards = cardsResult.data;
    }

    const tagsResult = await StorageManager.getAllTags();
    if (tagsResult.success) {
      backupData.data.tags = tagsResult.data;
    }

    const activeTagsResult = await StorageManager.getActiveTags();
    if (activeTagsResult.success && activeTagsResult.data) {
      backupData.data.activeTags = activeTagsResult.data;
    }

    // Include additional data for full backup
    if (scope === 'full') {
      const domainsResult = await StorageManager.getAllDomains();
      if (domainsResult.success) {
        backupData.data.domains = domainsResult.data;
      }

      const settingsResult = await StorageManager.getGlobalSettings();
      if (settingsResult.success) {
        backupData.data.globalSettings = settingsResult.data;
      }

      // Collect all statistics data
      const [
        dailyStatsResult,
        streakDataResult,
        domainBlockingStatsResult,
        tagPerformanceResult,
        cardResponsesResult
      ] = await Promise.all([
        indexedDBManager.getAllDailyStats(),
        indexedDBManager.getStreakData(),
        indexedDBManager.getAllDomainBlockingStats(),
        indexedDBManager.getAllTagPerformance(),
        indexedDBManager.getAllCardResponses()
      ]);

      backupData.data.statistics = {
        dailyStats: dailyStatsResult.success ? dailyStatsResult.data || [] : [],
        streakData: streakDataResult.success ? streakDataResult.data : null,
        domainBlockingStats: domainBlockingStatsResult.success ? domainBlockingStatsResult.data || [] : [],
        tagPerformance: tagPerformanceResult.success ? tagPerformanceResult.data || [] : [],
        cardResponses: cardResponsesResult.success ? cardResponsesResult.data || [] : []
      };
    }

    return backupData;
  }

  /**
   * Extract backup data from ZIP file
   */
  private static async extractBackupData(file: File): Promise<BackupData | null> {
    try {
      const zip = await JSZip.loadAsync(file);
      const backupFile = zip.file(this.BACKUP_FILENAME);
      
      if (!backupFile) {
        throw new Error('Backup data file not found in archive');
      }

      const backupText = await backupFile.async('text');
      const backupData = JSON.parse(backupText) as BackupData;
      
      // Basic validation
      if (!backupData.version || !backupData.timestamp || !backupData.scope) {
        throw new Error('Invalid backup data format');
      }

      return backupData;

    } catch (error) {
      if (error instanceof Error && error.message.includes('ZIP')) {
        // Try parsing as direct JSON (non-ZIP backup)
        try {
          const text = await file.text();
          const backupData = JSON.parse(text) as BackupData;
          
          if (!backupData.version || !backupData.timestamp || !backupData.scope) {
            throw new Error('Invalid backup data format');
          }
          
          return backupData;
        } catch {
          // Fall through to return null
        }
      }
      
      return null;
    }
  }

  /**
   * Import cards with conflict resolution
   */
  private static async importCards(
    backupData: BackupData, 
    strategy: ConflictStrategy, 
    report: ImportReport
  ): Promise<void> {
    if (!backupData.data.cards) return;

    const existingCards = await StorageManager.getAllCards();
    const existing = existingCards.success ? existingCards.data! : {};

    for (const [cardId, card] of Object.entries(backupData.data.cards)) {
      try {
        // Skip demo cards entirely during import (they have fixed IDs like demo_1, demo_2, etc.)
        if (cardId.startsWith('demo_')) {
          report.summary.cardsSkipped++;
          continue;
        }

        if (existing[cardId]) {
          // Handle conflict
          report.conflicts.push({
            type: 'card',
            id: cardId,
            action: strategy
          });

          switch (strategy) {
            case 'skip':
              report.summary.cardsSkipped++;
              continue;
              
            case 'rename':
              const newId = await this.generateUniqueCardId(existing);
              const renamedCard = { ...card, id: newId };
              const renameResult = await indexedDBManager.setCard(renamedCard);
              if (renameResult.success) {
                report.summary.cardsRenamed++;
                report.conflicts[report.conflicts.length - 1].newId = newId;
              } else {
                report.errors.push(`Failed to import renamed card ${cardId}: ${renameResult.error}`);
              }
              break;
              
            case 'overwrite':
              const overwriteResult = await indexedDBManager.setCard(card);
              if (overwriteResult.success) {
                report.summary.cardsImported++;
              } else {
                report.errors.push(`Failed to overwrite card ${cardId}: ${overwriteResult.error}`);
              }
              break;
          }
        } else {
          // No conflict, direct import
          const importResult = await indexedDBManager.setCard(card);
          if (importResult.success) {
            report.summary.cardsImported++;
          } else {
            report.errors.push(`Failed to import card ${cardId}: ${importResult.error}`);
          }
        }
      } catch (error) {
        report.errors.push(`Error processing card ${cardId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import tags with conflict resolution
   */
  private static async importTags(
    backupData: BackupData, 
    strategy: ConflictStrategy, 
    report: ImportReport
  ): Promise<void> {
    if (!backupData.data.tags) return;

    const existingTags = await StorageManager.getAllTags();
    const existing = existingTags.success ? existingTags.data! : {};

    for (const [tagId, tag] of Object.entries(backupData.data.tags)) {
      try {
        if (!existing[tagId] || strategy === 'overwrite') {
          const result = await indexedDBManager.setTag(tag);
          if (result.success) {
            report.summary.tagsImported++;
          } else {
            report.errors.push(`Failed to import tag ${tagId}: ${result.error}`);
          }
        }
        // For tags, we typically don't rename or create conflicts since they're referenced by name
      } catch (error) {
        report.errors.push(`Error processing tag ${tagId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import domains with conflict resolution
   */
  private static async importDomains(
    backupData: BackupData, 
    strategy: ConflictStrategy, 
    report: ImportReport
  ): Promise<void> {
    if (!backupData.data.domains) return;

    for (const [domain, domainSettings] of Object.entries(backupData.data.domains)) {
      try {
        const existingResult = await StorageManager.getDomain(domain);
        
        if (existingResult.success && existingResult.data) {
          // Handle conflict
          report.conflicts.push({
            type: 'domain',
            id: domain,
            action: strategy
          });

          if (strategy === 'skip') {
            continue;
          }
          // For domains, overwrite and rename are the same (overwrite)
        }

        const result = await StorageManager.setDomain(domain, domainSettings);
        if (result.success) {
          report.summary.domainsImported++;
        } else {
          report.errors.push(`Failed to import domain ${domain}: ${result.error}`);
        }
      } catch (error) {
        report.errors.push(`Error processing domain ${domain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import global settings
   */
  private static async importSettings(
    backupData: BackupData, 
    report: ImportReport
  ): Promise<void> {
    if (!backupData.data.globalSettings) return;

    try {
      const result = await StorageManager.updateGlobalSettings(backupData.data.globalSettings);
      if (result.success) {
        report.summary.settingsImported = true;
      } else {
        report.errors.push(`Failed to import settings: ${result.error}`);
      }
    } catch (error) {
      report.errors.push(`Error importing settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a unique card ID
   */
  private static async generateUniqueCardId(existingCards: Record<string, Card>): Promise<string> {
    let counter = 1;
    let newId: string;
    
    do {
      newId = `imported_${Date.now()}_${counter}`;
      counter++;
    } while (existingCards[newId]);
    
    return newId;
  }

  /**
   * Group conflicts by type for reporting
   */
  private static groupConflictsByType(conflicts: DataConflict[]): Record<string, number> {
    const groups: Record<string, number> = {};
    
    for (const conflict of conflicts) {
      groups[conflict.type] = (groups[conflict.type] || 0) + 1;
    }
    
    return groups;
  }

  /**
   * Import processed cards (after conflict resolution)
   */
  private static async importProcessedCards(
    cards: Record<string, Card>,
    report: ImportReport
  ): Promise<void> {
    for (const [cardId, card] of Object.entries(cards)) {
      try {
        const result = await indexedDBManager.setCard(card);
        if (result.success) {
          report.summary.cardsImported++;
        } else {
          report.errors.push(`Failed to import card ${cardId}: ${result.error}`);
        }
      } catch (error) {
        report.errors.push(`Error importing card ${cardId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import processed tags (after conflict resolution)
   */
  private static async importProcessedTags(
    tags: Record<string, Tag>,
    report: ImportReport
  ): Promise<void> {
    for (const [tagId, tag] of Object.entries(tags)) {
      try {
        const result = await indexedDBManager.setTag(tag);
        if (result.success) {
          report.summary.tagsImported++;
        } else {
          report.errors.push(`Failed to import tag ${tagId}: ${result.error}`);
        }
      } catch (error) {
        report.errors.push(`Error importing tag ${tagId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import processed domains (after conflict resolution)
   */
  private static async importProcessedDomains(
    domains: Record<string, DomainSettings>,
    report: ImportReport
  ): Promise<void> {
    for (const [domain, domainSettings] of Object.entries(domains)) {
      try {
        const result = await StorageManager.setDomain(domain, domainSettings);
        if (result.success) {
          report.summary.domainsImported++;
        } else {
          report.errors.push(`Failed to import domain ${domain}: ${result.error}`);
        }
      } catch (error) {
        report.errors.push(`Error importing domain ${domain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Import processed settings (after conflict resolution)
   */
  private static async importProcessedSettings(
    settings: GlobalSettings,
    report: ImportReport
  ): Promise<void> {
    try {
      const result = await StorageManager.updateGlobalSettings(settings);
      if (result.success) {
        report.summary.settingsImported = true;
      } else {
        report.errors.push(`Failed to import settings: ${result.error}`);
      }
    } catch (error) {
      report.errors.push(`Error importing settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import active tags
   */
  private static async importActiveTags(activeTags: string[]): Promise<void> {
    try {
      await StorageManager.setActiveTags(activeTags);
    } catch (error) {
      // Silently fail - active tags are not critical
    }
  }

  /**
   * Import statistics data
   */
  private static async importStatistics(
    statistics: any,
    report: ImportReport
  ): Promise<void> {
    try {
      let hasErrors = false;

      // Import daily stats
      if (statistics.dailyStats && Array.isArray(statistics.dailyStats)) {
        for (const dailyStat of statistics.dailyStats) {
          const result = await indexedDBManager.setDailyStats(dailyStat);
          if (!result.success) {
            report.errors.push(`Failed to import daily stat for ${dailyStat.date}: ${result.error}`);
            hasErrors = true;
          }
        }
      }

      // Import streak data
      if (statistics.streakData) {
        const result = await indexedDBManager.setStreakData(statistics.streakData);
        if (!result.success) {
          report.errors.push(`Failed to import streak data: ${result.error}`);
          hasErrors = true;
        }
      }

      // Import domain blocking stats
      if (statistics.domainBlockingStats && Array.isArray(statistics.domainBlockingStats)) {
        for (const domainStat of statistics.domainBlockingStats) {
          const result = await indexedDBManager.setDomainBlockingStats(domainStat);
          if (!result.success) {
            report.errors.push(`Failed to import domain blocking stats for ${domainStat.domain}: ${result.error}`);
            hasErrors = true;
          }
        }
      }

      // Import tag performance
      if (statistics.tagPerformance && Array.isArray(statistics.tagPerformance)) {
        for (const tagPerf of statistics.tagPerformance) {
          const result = await indexedDBManager.setTagPerformance(tagPerf);
          if (!result.success) {
            report.errors.push(`Failed to import tag performance for ${tagPerf.tagName}: ${result.error}`);
            hasErrors = true;
          }
        }
      }

      // Import card responses
      if (statistics.cardResponses && Array.isArray(statistics.cardResponses)) {
        for (const response of statistics.cardResponses) {
          const result = await indexedDBManager.addCardResponse(response);
          if (!result.success) {
            report.errors.push(`Failed to import card response: ${result.error}`);
            hasErrors = true;
          }
        }
      }

      // Mark statistics as imported if at least some data was imported successfully
      if (!hasErrors || statistics.dailyStats?.length > 0 || statistics.streakData) {
        report.summary.statisticsImported = true;
      }
    } catch (error) {
      report.errors.push(`Error importing statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available backup snapshots for manual recovery
   */
  static async getAvailableSnapshots() {
    return await ImportTransaction.getAvailableSnapshots();
  }

  /**
   * Manually restore from a specific snapshot
   */
  static async restoreFromSnapshot(snapshotId: string): Promise<void> {
    try {
      await ImportTransaction.restoreFromSnapshot(snapshotId);
    } catch (error) {
      throw new Error(`Snapshot restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a specific snapshot
   */
  static async deleteSnapshot(snapshotId: string): Promise<void> {
    try {
      await ImportTransaction.deleteSnapshot(snapshotId);
    } catch (error) {
      throw new Error(`Snapshot deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate current data integrity
   */
  static async validateDataIntegrity(): Promise<ValidationResult> {
    const transaction = new ImportTransaction();
    // Use the private validation method via a transaction instance
    return await (transaction as any).validateDataIntegrity();
  }
} 