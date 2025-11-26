// Background service worker for Rekapu extension

import { StorageManager } from '../storage/StorageManager';
import { StorageQuotaManager } from '../storage/StorageQuotaManager';
import { SpacedRepetitionEngine } from '../spaced-repetition/SpacedRepetitionEngine';
import { StatisticsEngine } from '../storage/StatisticsEngine';
import { BackupManager } from '../storage/BackupManager';
import { getEffectiveDueDate } from '../utils/dateUtils';
import { Card } from '../types/index';
import { BackupScope } from '../types/storage';
import { DailyToastTracker } from './toastTracker';
import { TTSKeyStorage } from '../tts/TTSKeyStorage';
import { TTSService } from '../tts/TTSService';
import { indexedDBManager } from '../storage/IndexedDBManager';
import { loadDemoCards } from '../utils/demoCardsLoader';
import { loadDefaultDomains } from '../utils/defaultDomainsLoader';

/**
 * Simple cloze renderer for background script (no external dependencies)
 */
function renderClozeWithMaskInBackground(text: string, maskDeletionId: number, placeholder: string = '[...]'): string {
  const clozeRegex = /\{\{c(\d+)::([^:}]+)(?:::([^}]*))?\}\}/g;
  
  return text.replace(clozeRegex, (match, id, clozeText, hint) => {
    const clozeId = parseInt(id, 10);
    
    if (clozeId === maskDeletionId) {
      // This is the deletion to mask
      const hintText = hint?.trim();
      return hintText ? `${placeholder} (${hintText})` : placeholder;
    } else {
      // This deletion should be shown
      return clozeText.trim();
    }
  });
}

// State management
let blockedDomains: Set<string> = new Set();
let isInitialized = false;
let extensionCapabilities: ExtensionCapabilities;

// Track domain cooldown alarms for cleanup
let domainCooldownAlarms: Set<string> = new Set();

// Track active backup/import operations for progress streaming
const activeOperations = new Map<string, {
  type: 'export' | 'import' | 'anki_import';
  progress: number;
  status: string;
  tabId?: number;
  portId?: string;
}>();

// Extension capability levels
interface ExtensionCapabilities {
  level: 'full' | 'partial' | 'minimal';
  apis: {
    webNavigation: boolean;
    tabs: boolean;
    scripting: boolean;
    storage: boolean;
    action: boolean;
  };
  permissions: {
    allUrls: boolean;
    webNavigation: boolean;
  };
  fallbacks: {
    useBasicStorage: boolean;
    limitedTabManagement: boolean;
  };
}

/**
 * Comprehensive runtime API and permission checker
 */
async function checkExtensionCapabilities(): Promise<ExtensionCapabilities> {
  
  const capabilities: ExtensionCapabilities = {
    level: 'full',
    apis: {
      webNavigation: false,
      tabs: false,
      scripting: false,
      storage: false,
      action: false,
    },
    permissions: {
      allUrls: false,
      webNavigation: false,
    },
    fallbacks: {
      useBasicStorage: false,
      limitedTabManagement: false,
    }
  };

  try {
    // Check API availability
    capabilities.apis.webNavigation = !!(chrome.webNavigation);
    capabilities.apis.tabs = !!(chrome.tabs);
    capabilities.apis.scripting = !!(chrome.scripting);
    capabilities.apis.storage = !!(chrome.storage);
    capabilities.apis.action = !!(chrome.action);

    // Check permissions
    try {
      const permissions = await chrome.permissions.getAll();
      capabilities.permissions.allUrls = permissions.origins?.includes('<all_urls>') || false;
      capabilities.permissions.webNavigation = permissions.permissions?.includes('webNavigation') || false;
    } catch (error) {
      console.warn('Could not check permissions:', error);
    }

    // Test API functionality
    if (capabilities.apis.tabs) {
      try {
        await chrome.tabs.query({ active: true, currentWindow: true });
      } catch (error) {
        console.warn('tabs API available but limited:', error);
      }
    }

    // Determine capability level and fallbacks
    const criticalApis = [
      capabilities.apis.storage,
      capabilities.apis.tabs,
      capabilities.apis.scripting
    ];

    const enhancedApis = [
      capabilities.apis.webNavigation,
      capabilities.apis.action
    ];

    const criticalMissing = criticalApis.filter(api => !api).length;
    const enhancedMissing = enhancedApis.filter(api => !api).length;

    if (criticalMissing > 0) {
      capabilities.level = 'minimal';
      capabilities.fallbacks.useBasicStorage = !capabilities.apis.storage;
      capabilities.fallbacks.limitedTabManagement = !capabilities.apis.tabs;
    } else if (enhancedMissing > 0) {
      capabilities.level = 'partial';
    }

    // Set fallback flags
    if (!capabilities.apis.action) {
      capabilities.fallbacks.limitedTabManagement = true;
      console.warn('⚠ action API not available, tab badges disabled');
    }

    return capabilities;
  } catch (error) {
    console.error('Error checking extension capabilities:', error);
    capabilities.level = 'minimal';
    return capabilities;
  }
}

/**
 * Show user notification about limited functionality
 */
async function notifyLimitedFunctionality(capabilities: ExtensionCapabilities): Promise<void> {
  if (capabilities.level === 'full') {
    return;
  }

  const limitations: string[] = [];
  
  if (capabilities.fallbacks.limitedTabManagement) {
    limitations.push('Tab badges and advanced tab management disabled');
  }
  
  if (capabilities.fallbacks.useBasicStorage) {
    limitations.push('Advanced storage features may be limited');
  }

  if (limitations.length > 0) {
    console.warn(`Extension running with ${capabilities.level} functionality:`, limitations);
    
    // Try to show notification if available
    try {
      if (chrome.notifications) {
        await chrome.notifications.create('limited-functionality', {
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Rekapu - Limited Functionality',
          message: `Extension running with ${capabilities.level} functionality. Some features may be limited.`
        });
      }
    } catch (error) {
      console.log('Could not show notification:', error);
    }
  }
}

/**
 * Safe API wrapper with fallback handling
 */
class SafeAPIWrapper {
  static async updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<void> {
    if (!extensionCapabilities?.apis?.tabs) {
      return;
    }

    try {
      await chrome.tabs.update(tabId, updateProperties);
    } catch (error) {
      console.error('Failed to update tab:', error);
    }
  }

  static async queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    if (!extensionCapabilities?.apis?.tabs) {
      return [];
    }

    try {
      const tabs = await chrome.tabs.query(queryInfo);
      return tabs;
    } catch (error) {
      console.error('Failed to query tabs:', error);
      return [];
    }
  }
}

/**
 * Setup context menu items for quick card creation
 */
function setupContextMenus(): void {
  if (!chrome.contextMenus) {
    console.warn('contextMenus API not available');
    return;
  }

  // Remove all existing menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Create "Add selection as card" menu item (only when text is selected)
    chrome.contextMenus.create({
      id: 'add-selection-as-card',
      title: chrome.i18n.getMessage('contextMenuAddSelection'),
      contexts: ['selection']
    });
  });
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add-selection-as-card' && info.selectionText) {
    handleAddSelectionAsCard(info.selectionText, tab);
  }
});

/**
 * Open dashboard with pre-filled card from selected text
 */
async function handleAddSelectionAsCard(selectedText: string, tab?: chrome.tabs.Tab): Promise<void> {
  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    
    // Encode the selected text to pass as URL parameter
    const encodedText = encodeURIComponent(selectedText);
    const urlWithText = `${dashboardUrl}?prefill=${encodedText}`;
    
    // Open dashboard in a new tab with pre-filled card
    await chrome.tabs.create({
      url: urlWithText,
      active: true
    });
  } catch (error) {
    console.error('Error opening dashboard with selected text:', error);
  }
}

// Initialize extension on startup
chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
  setupContextMenus();
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details: chrome.runtime.InstalledDetails) => {
  await initializeExtension();
  setupContextMenus();
  
  // Load demo cards and default domains on first installation
  if (details.reason === 'install') {
    
    // Load demo cards
    const cardsResult = await loadDemoCards();
    if (cardsResult.success && cardsResult.cardsLoaded > 0) {
    } else if (cardsResult.error) {
      console.error('❌ Failed to load demo cards:', cardsResult.error);
    }
    
    // Load default domains
    const domainsResult = await loadDefaultDomains();
    if (domainsResult.success && domainsResult.domainsLoaded > 0) {
      // Update blocking rules to activate the default domains
      await updateBlockingRules();
    } else if (domainsResult.error) {
      console.error('❌ Failed to load default domains:', domainsResult.error);
    }
  }
});

// Handle alarm events for domain re-blocking
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name.startsWith('reblock-')) {
      const domain = alarm.name.replace('reblock-', '');
      
      // Update blocking rules to re-add this domain
      await updateBlockingRules();
      
      // Show overlays on existing tabs instead of refreshing
      await showOverlaysOnDomainTabs(domain);
      
      // Remove the domain from our tracking set
      domainCooldownAlarms.delete(domain);
    }
  } catch (error) {
    console.error(`Error handling alarm ${alarm.name}:`, error);
  }
});

/**
 * Set up cooldown alarms for domains that are currently in cooldown
 * Called during extension initialization to restore alarms after restart
 */
async function setupCooldownTimers(): Promise<void> {
  try {
    const domainsResult = await StorageManager.getAllDomains();
    if (!domainsResult.success || !domainsResult.data) {
      return;
    }

    const activeDomains = Object.values(domainsResult.data)
      .filter(domain => domain.isActive);

    const now = Date.now();
    
    for (const domain of activeDomains) {
      // Skip domains that were never unblocked
      if (domain.lastUnblock === 0) {
        continue;
      }

      const timeSinceLastUnblock = now - domain.lastUnblock;
      const cooldownMs = domain.cooldownPeriod * 60 * 1000;
      const timeRemaining = cooldownMs - timeSinceLastUnblock;

      // If domain is still in cooldown, set up alarm for when it expires
      if (timeRemaining > 0) {
        const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
        console.log(`Restoring cooldown alarm for ${domain.domain}: ${minutesRemaining} minutes remaining`);
        
        // Create alarm for this domain
        const alarmName = `reblock-${domain.domain}`;
        const when = Date.now() + timeRemaining;
        
        await chrome.alarms.create(alarmName, { when });
        domainCooldownAlarms.add(domain.domain);
      }
    }

  } catch (error) {
    console.error('Error setting up cooldown alarms:', error);
  }
}

/**
 * Update extension badge (simplified - no dynamic badges)
 */
async function updateExtensionBadge(): Promise<void> {
  try {
    if (!extensionCapabilities?.apis?.action) {
      return;
    }

    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Rekapu' });
  } catch (error) {
    console.error('Failed to update extension badge:', error);
  }
}

/**
 * Initialize storage with default values and setup blocking rules
 */
async function initializeExtension(): Promise<void> {
  try {
    
    // First, check extension capabilities
    extensionCapabilities = await checkExtensionCapabilities();
    
    // Notify user if running with limited functionality
    await notifyLimitedFunctionality(extensionCapabilities);
    
    // Initialize storage
    const initResult = await StorageManager.initialize();
    if (!initResult.success) {
      console.error('Failed to initialize storage:', initResult.error);
      return;
    }

    // Load blocked domains into cache
    await loadBlockedDomains();

    // Set up timers for domains currently in cooldown (restore timers after restart)
    await setupCooldownTimers();

    // Check quota status on startup if storage API is available
    if (extensionCapabilities?.apis?.storage) {
      const quotaResult = await StorageQuotaManager.checkQuotaStatus();
      if (quotaResult.success) {
        const { status, percentage } = quotaResult.data!;
        
        // Perform auto cleanup if needed
        if (status === 'warning' || status === 'critical' || status === 'exceeded') {
          const cleanupResult = await StorageQuotaManager.performAutoCleanup();
          if (cleanupResult.success) {
            console.log('Cleanup completed:', cleanupResult.data!.cleanupActions);
          }
        }
      }
    }

    // Update extension badge with current streak
    await updateExtensionBadge();
    
    isInitialized = true;
    
    // Set up backup periodic check every 30 seconds (much more frequent)
    // This ensures domains get re-blocked even if timers fail
    setInterval(async () => {
      try {
        if (extensionCapabilities) {
          await updateBlockingRules();
        }
      } catch (error) {
        console.error('Error in backup blocking rules refresh:', error);
      }
    }, 30 * 1000); // Every 30 seconds
  } catch (error) {
    console.error('Extension initialization failed:', error);
  }
}

/**
 * Load blocked domains from storage into memory cache
 */
async function loadBlockedDomains(): Promise<void> {
  try {
    const result = await StorageManager.getAllDomains();
    if (result.success && result.data) {
      const activeDomains = Object.values(result.data)
        .filter(domain => domain.isActive)
        .map(domain => domain.domain);
      
      // Create a new set with domain variations
      const domainSet = new Set<string>();
      
      for (const domain of activeDomains) {
        // Add the original domain
        domainSet.add(domain);
        
        // Add variations (with and without www.)
        if (domain.startsWith('www.')) {
          domainSet.add(domain.substring(4)); // Remove www.
        } else {
          domainSet.add(`www.${domain}`); // Add www.
        }
      }
      
      blockedDomains = domainSet;
    }
  } catch (error) {
    console.error('Error loading blocked domains:', error);
  }
}

/**
 * Update blocking rules when domain settings change
 */
async function updateBlockingRules(): Promise<void> {
  // Ensure extension is initialized before proceeding
  if (!extensionCapabilities) {
    return;
  }
  
  await loadBlockedDomains();
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations with proper response handling
  (async () => {
    try {
      let result;
      
      // Handle StorageAPI messages (use action field)
      if (message.action) {
        switch (message.action) {
          // Domain operations
          case 'storage_getDomainsCount':
            result = await StorageManager.getDomainsCount();
            break;
          case 'storage_getAllDomains':
            result = await StorageManager.getAllDomains();
            break;
          case 'storage_getDomain':
            result = await StorageManager.getDomain(message.data.domain);
            break;
          case 'storage_setDomain':
            result = await StorageManager.setDomain(message.data.domain, message.data.settings);
            if (result.success) {
              await updateBlockingRules();
              // Immediately show blocking overlays on existing tabs
              await showOverlaysOnDomainTabs(message.data.domain);
            }
            break;
          case 'storage_removeDomain':
            result = await StorageManager.removeDomain(message.data.domain);
            if (result.success) {
              await updateBlockingRules();
            }
            break;
          case 'checkDomainBlocked':
            result = await handleDomainCheck(message.data);
            break;
          case 'unblockDomain':
            result = await StorageManager.getDomain(message.data.domain);
            if (result.success && result.data) {
              await updateDomainUnblockTime(message.data.domain);
              result = { success: true, data: result.data };
            }
            break;

          // Card operations
          case 'storage_getCardsCount':
            result = await StorageManager.getCardsCount();
            break;
          case 'storage_getAllCards':
            result = await StorageManager.getAllCards();
            break;
          case 'storage_getCardsPaginated':
            result = await StorageManager.getCardsPaginated(message.data);
            break;
          case 'storage_getCardSummaries':
            result = await StorageManager.getCardSummaries();
            break;
          case 'storage_getCard':
            result = await StorageManager.getCard(message.data.id);
            break;
          case 'storage_getCardIds':
            result = await StorageManager.getCardIds();
            break;
          case 'storage_getRandomCard':
            result = await handleGetRandomCard(message);
            break;
          case 'storage_createCard':
            result = await StorageManager.createCard(message.data);
            break;
          case 'storage_updateCard':
            result = await StorageManager.updateCard(message.data.id, message.data.updates);
            break;
          case 'storage_removeCard':
            result = await StorageManager.removeCard(message.data.id);
            break;

          // Tag operations
          case 'storage_getAllUniqueTagNames':
            result = await StorageManager.getAllUniqueTagNames();
            break;
          case 'storage_getAllTags':
            result = await StorageManager.getAllTags();
            break;
          case 'storage_ensureTagsExist':
            result = await StorageManager.ensureTagsExist(message.data.tagNames);
            break;
          case 'storage_getTag':
            result = await StorageManager.getTag(message.data.id);
            break;
          case 'storage_createTag':
            result = await StorageManager.createTag(message.data);
            break;
          case 'storage_updateTag':
            result = await StorageManager.updateTag(message.data.id, message.data.updates);
            break;
          case 'storage_removeTag':
            result = await StorageManager.removeTag(message.data.id);
            break;
          case 'storage_getCardsByTags':
            result = await StorageManager.getCardsByTags(message.data.tagNames);
            break;
          case 'storage_getRandomCardFromTags':
            result = await StorageManager.getRandomCardFromTags(message.data.tagNames);
            break;

          // Settings operations
          case 'storage_getGlobalSettings':
            result = await StorageManager.getGlobalSettings();
            break;
          case 'storage_updateGlobalSettings':
            result = await StorageManager.updateGlobalSettings(message.data);
            break;

          // Response operations
          case 'storage_getResponses':
            result = await StorageManager.getResponses();
            break;
          case 'storage_addResponse':
            result = await StorageManager.addResponse(message.data);
            break;

          // Storage stats operations
          case 'storage_getStats':
            result = await StorageManager.getStats();
            break;
          case 'storage_getStorageUsage':
            result = await StorageManager.getStorageUsage();
            break;
          case 'storage_clearAll':
            result = await StorageManager.clearAll();
            break;

          // Quota operations
          case 'quota_checkStatus':
            result = await StorageQuotaManager.checkQuotaStatus();
            break;
          case 'quota_cleanup':
            result = await StorageQuotaManager.performAutoCleanup();
            break;
          case 'quota_cleanupResponses':
            result = await StorageQuotaManager.cleanupOldResponses(message.data?.keepCount);
            break;
          case 'quota_cleanupCards':
            result = await StorageQuotaManager.cleanupOldCards(message.data?.olderThanDays);
            break;
          case 'quota_getStorageBreakdown':
            result = await StorageQuotaManager.getStorageBreakdown();
            break;
          case 'quota_validateStorageSpace':
            result = await StorageQuotaManager.validateStorageSpace(message.data.size);
            break;

          // Active Tags Management
          case 'storage_getActiveTags':
            result = await StorageManager.getActiveTags();
            break;
          case 'storage_setActiveTags':
            result = await StorageManager.setActiveTags(message.data.tagNames);
            break;
          case 'storage_addActiveTag':
            result = await StorageManager.addActiveTag(message.data.tagName);
            break;
          case 'storage_removeActiveTag':
            result = await StorageManager.removeActiveTag(message.data.tagName);
            break;

          // Daily toast tracking operations
          case 'toast_recordShown':
            await DailyToastTracker.recordToastShown(message.data.domain);
            result = { success: true };
            break;
          case 'toast_shouldShow':
            const shouldShow = await DailyToastTracker.shouldShowToast(message.data.domain);
            result = { success: true, data: shouldShow };
            break;
          case 'toast_getStats':
            const stats = await DailyToastTracker.getStats();
            result = { success: true, data: stats };
            break;
          case 'toast_cleanup':
            const cleanupResult = await DailyToastTracker.performCleanup();
            result = { success: true, data: cleanupResult };
            break;

          // Statistics operations
          case 'stats_getHeatMapData':
            try {
              const { startDate, endDate, tagNames } = message.data;
              const heatMapResult = await StatisticsEngine.generateHeatMapData(
                new Date(startDate), 
                new Date(endDate),
                tagNames
              );
              result = heatMapResult;
            } catch (error) {
              result = { success: false, error: `Failed to get heat map data: ${error}` };
            }
            break;
          case 'stats_getStreakInfo':
            try {
              const streakResult = await StatisticsEngine.calculateStreakInfo();
              result = streakResult;
            } catch (error) {
              result = { success: false, error: `Failed to get streak info: ${error}` };
            }
            break;
          case 'stats_getPerformanceMetrics':
            try {
              const { tagNames } = message.data || {};
              const performanceResult = await StatisticsEngine.calculatePerformanceMetrics(tagNames);
              result = performanceResult;
            } catch (error) {
              result = { success: false, error: `Failed to get performance metrics: ${error}` };
            }
            break;
          case 'stats_getAvailableYears':
            try {
              result = await StatisticsEngine.getAvailableYears();
            } catch (error) {
              result = { success: false, error: `Failed to get available years: ${error}` };
            }
            break;
          case 'stats_getBacklogInfo':
            try {
              const { tagNames, dailyGoal } = message.data || {};
              result = await StatisticsEngine.getBacklogInfo(tagNames, dailyGoal);
            } catch (error) {
              result = { success: false, error: `Failed to get backlog info: ${error}` };
            }
            break;
          case 'stats_getProblematicCards':
            try {
              const { tagNames, limit } = message.data || {};
              result = await StatisticsEngine.getProblematicCards(tagNames, limit);
            } catch (error) {
              result = { success: false, error: `Failed to get problematic cards: ${error}` };
            }
            break;
          case 'stats_getTopTimeWasters':
            try {
              const { limit } = message.data || {};
              result = await StatisticsEngine.getTopTimeWasters(limit);
            } catch (error) {
              result = { success: false, error: `Failed to get top time wasters: ${error}` };
            }
            break;

          // Backup and Import operations
          case 'backup_export':
            result = await handleExportBackup(message);
            break;
          case 'backup_import':
            result = await handleImportBackup(message);
            break;
          case 'backup_detectConflicts':
            result = await handleDetectConflicts(message);
            break;
          case 'backup_importWithResolution':
            result = await handleImportWithResolution(message);
            break;
          case 'backup_importAnki':
            result = await handleImportAnki(message);
            break;
          case 'backup_importCardsBatch':
            result = await handleImportCardsBatch(message);
            break;

          case 'operation_getProgress':
            result = await handleGetOperationProgress(message);
            break;
          case 'operation_cancel':
            result = await handleCancelOperation(message);
            break;
          case 'backup_getSnapshots':
            result = await handleGetSnapshots(message);
            break;
          case 'backup_restoreSnapshot':
            result = await handleRestoreSnapshot(message);
            break;
          case 'backup_deleteSnapshot':
            result = await handleDeleteSnapshot(message);
            break;
          case 'backup_validateIntegrity':
            result = await handleValidateIntegrity(message);
            break;

          default:
            result = { success: false, error: `Unknown action: ${message.action}` };
        }
      }
      // Handle legacy message types and new message types
      else if (message.type) {
        switch (message.type) {
          case 'STORAGE_OPERATION':
            result = await handleStorageOperation(message);
            break;
          case 'CHECK_DOMAIN_BLOCKING':
            result = await handleDomainCheck(message);
            break;
          case 'GET_RANDOM_CARD':
            result = await handleGetRandomCard(message);
            break;
          case 'VALIDATE_ANSWER':
            result = await handleValidateAnswer(message);
            break;
          case 'LOG_CARD_RESPONSE':
            result = await handleLogCardResponse(message);
            break;
          case 'GET_NEXT_OCCURRENCES':
            result = await handleGetNextOccurrences(message);
            break;
          case 'GET_DUE_CARDS_COUNT':
            result = await handleGetDueCardsCount(message);
            break;
          case 'CHECK_TTS_FOR_CARD':
            result = await handleCheckTTSForCard(message);
            break;
          case 'SYNTHESIZE_TTS':
            result = await handleSynthesizeTTS(message);
            break;
          case 'GET_MEDIA_URL':
            result = await handleGetMediaUrl(message);
            break;
          case 'OPEN_POPUP':
            result = await handleOpenPopup(message);
            break;
          case 'FORCE_UNBLOCK_DOMAIN':
            result = await handleForceUnblockDomain(message);
            break;
          case 'GET_ORIGINAL_URL':
            result = await handleGetOriginalUrl(message, sender);
            break;
          case 'REFRESH_UNBLOCKED_DOMAIN_TABS':
            await refreshUnblockedDomainTabs(message.domain);
            result = { success: true };
            break;
          case 'ANSWER_SUBMITTED':
            result = await handleAnswerSubmitted(message);
            break;
          case 'UPDATE_BLOCKING_RULES':
            await updateBlockingRules();
            result = { success: true };
            break;
          case 'SHOW_DOMAIN_OVERLAYS':
            await showOverlaysOnDomainTabs(message.domain || message.data?.domain);
            result = { success: true };
            break;
          case 'GET_EXTENSION_STATE':
            result = await handleGetExtensionState();
            break;
          case 'getCards':
            result = await StorageManager.getAllCards();
            break;
          default:
            result = { success: false, error: `Unknown message type: ${message.type}` };
        }
      }
      else {
        result = { success: false, error: 'Message missing both action and type fields' };
      }
      
      sendResponse(result);
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: `Message handling failed: ${error}` });
    }
  })();
  
  return true; // Keep message channel open for async response
});

/**
 * Get current extension state
 */
async function handleGetExtensionState(): Promise<any> {
  return {
    success: true,
    data: {
      isInitialized,
      blockedDomainsCount: blockedDomains.size,
      blockedDomains: Array.from(blockedDomains),
      capabilities: extensionCapabilities || null,
      runtime: {
        timestamp: Date.now(),
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      }
    }
  };
}

/**
 * Handle storage operations from other parts of the extension
 */
async function handleStorageOperation(message: any): Promise<any> {
  try {
    const { operation, data } = message;
    let result;

    switch (operation) {
      case 'getDomains':
        result = await StorageManager.getAllDomains();
        break;
      case 'setDomain':
        result = await StorageManager.setDomain(data.domain, data.settings);
        // Update blocking rules when domain settings change
        if (result.success) {
          await updateBlockingRules();
          // Immediately show blocking overlays on existing tabs
          await showOverlaysOnDomainTabs(data.domain);
        }
        break;
      case 'removeDomain':
        result = await StorageManager.removeDomain(data.domain);
        // Update blocking rules when domain is removed
        if (result.success) {
          await updateBlockingRules();
        }
        break;
      case 'getCards':
        result = await StorageManager.getAllCards();
        break;
      case 'createCard':
        result = await StorageManager.createCard(data);
        break;
      case 'updateCard':
        result = await StorageManager.updateCard(data.id, data.updates);
        break;
      case 'removeCard':
        result = await StorageManager.removeCard(data.id);
        break;
      case 'getSettings':
        result = await StorageManager.getGlobalSettings();
        break;
      case 'updateSettings':
        result = await StorageManager.updateGlobalSettings(data);
        break;
      case 'addResponse':
        result = await StorageManager.addResponse(data);
        break;
      case 'storage_getRandomCardFromTags':
        result = await StorageManager.getRandomCardFromTags(data.tagNames);
        break;

      // Active Tags Management
      case 'storage_getActiveTags':
        result = await StorageManager.getActiveTags();
        break;
      case 'storage_setActiveTags':
        result = await StorageManager.setActiveTags(data.tagNames);
        break;
      case 'storage_addActiveTag':
        result = await StorageManager.addActiveTag(data.tagName);
        break;
      case 'storage_removeActiveTag':
        result = await StorageManager.removeActiveTag(data.tagName);
        break;

      default:
        result = {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: `Storage operation failed: ${error}`,
    };
  }
}

/**
 * Check if a domain should be blocked (with cache optimization)
 */
async function handleDomainCheck(message: any): Promise<any> {
  try {
    const { domain } = message;
    
    // Create variations of the domain to check
    const normalizedDomain = domain.replace(/^www\./, '');
    const domainVariations = [
      domain,
      normalizedDomain,
      domain.startsWith('www.') ? domain : `www.${domain}`,
    ];
    
    // Check each variation directly in storage (skip cache to avoid stale data)
    let domainResult = null;
    let matchedDomain = null;
    
    for (const variant of domainVariations) {
      domainResult = await StorageManager.getDomain(variant);
      if (domainResult.success && domainResult.data && domainResult.data.isActive) {
        matchedDomain = variant;
        break;
      }
    }
    
    // If subdomain not found, try parent domain (web.telegram.org -> telegram.org)
    if (!domainResult || !domainResult.success || !domainResult.data || !domainResult.data.isActive) {
      const parts = normalizedDomain.split('.');
      if (parts.length > 2) {
        const parentDomain = parts.slice(-2).join('.'); // Get telegram.org from web.telegram.org
        domainResult = await StorageManager.getDomain(parentDomain);
        if (domainResult.success && domainResult.data && domainResult.data.isActive) {
          matchedDomain = parentDomain;
        }
      }
    }
    
    if (domainResult && domainResult.success && domainResult.data && domainResult.data.isActive) {
        const domainSettings = domainResult.data;
        
        // Check if cooldown period has passed
        const now = Date.now();
        const timeSinceLastUnblock = now - domainSettings.lastUnblock;
        const cooldownMs = domainSettings.cooldownPeriod * 60 * 1000; // Convert minutes to ms

        // If lastUnblock is 0, domain should be blocked (never answered)
        // If lastUnblock is recent and cooldown hasn't passed, domain should be UNBLOCKED
        // If lastUnblock is old and cooldown has passed, domain should be blocked again
        const isNeverUnblocked = domainSettings.lastUnblock === 0;
        const isInCooldown = timeSinceLastUnblock < cooldownMs;
        const shouldBeBlocked = isNeverUnblocked || !isInCooldown;

        if (shouldBeBlocked) {
          // Domain should be blocked - but check if user is caught up
          
          // Check if user has caught up on all cards
          const activeTagsResult = await StorageManager.getActiveTags();
          const activeTags = activeTagsResult.success ? activeTagsResult.data || [] : [];
          const dueCardsResult = await getDueCardsEfficiently(activeTags, []);
          
          const isCaughtUp = dueCardsResult.success && dueCardsResult.data.length === 0;
          
          if (isCaughtUp) {
            // User is caught up - always allow pass-through
            const shouldShowToast = await DailyToastTracker.shouldShowToast(domain);
            
            let toastMessage;
            if (shouldShowToast) {
              // Get next card timing for more informative message
              const allCardsResult = await StorageManager.getAllCards();
              if (allCardsResult.success && allCardsResult.data) {
                const cards = Object.values(allCardsResult.data);
                if (cards.length > 0) {
                  // Find next due card
                  const nextDueCard = cards
                    .filter(q => activeTags.length === 0 || q.tags.some(tag => activeTags.includes(tag)))
                    .sort((a, b) => getEffectiveDueDate(a) - getEffectiveDueDate(b))[0];

                  if (nextDueCard) {
                    const timeUntilNext = getEffectiveDueDate(nextDueCard) - Date.now();
                    const hours = Math.ceil(timeUntilNext / (1000 * 60 * 60));
                    const days = Math.ceil(timeUntilNext / (1000 * 60 * 60 * 24));
                    
                    let nextAvailable = '';
                    if (days > 1) {
                      nextAvailable = `Next card in ${days} days`;
                    } else if (hours > 1) {
                      nextAvailable = `Next card in ${hours} hours`;
                    } else {
                      nextAvailable = 'Next card available soon';
                    }
                    
                    toastMessage = `Rekapu: Great job! You're all caught up. ${nextAvailable}.`;
                  } else {
                    toastMessage = "Rekapu: You're all caught up! No more cards scheduled.";
                  }
                } else {
                  toastMessage = "Rekapu: You're all caught up! Time to add some cards.";
                }
              } else {
                toastMessage = "Rekapu: You're all caught up!";
              }
            }
            
            return {
              blocked: false,
              domain: domain,
              timeRemaining: 0,
              settings: domainSettings,
              caughtUp: true,
              shouldShowToast: shouldShowToast,
              message: toastMessage
            };
          }
          
          // Normal blocking - user has cards due
          // For never unblocked domains, show full cooldown period
          // For expired cooldown domains, don't show time remaining
          const timeRemaining = isNeverUnblocked ? cooldownMs : 0;
          return {
            blocked: true,
            domain: domain,
            timeRemaining: timeRemaining,
            settings: domainSettings,
          };
        } else {
          // Within cooldown period - domain is accessible
          // Show how much time is left before it gets blocked again
          const timeRemaining = cooldownMs - timeSinceLastUnblock;
          return {
            blocked: false,
            domain: domain,
            timeRemaining: timeRemaining,
            settings: domainSettings,
          };
        }
    }
    
    // No active domain settings found - domain is not blocked
    return {
      blocked: false,
      domain: domain,
    };
  } catch (error) {
    console.error('Domain check error:', error);
    return {
      blocked: false,
      error: `Domain check failed: ${error}`,
    };
  }
}

/**
 * Get a card for the blocked domain using spaced repetition scheduling
 */
async function handleGetRandomCard(message: any): Promise<any> {
  try {
    const { domain, excludeIds = [] } = message;
    
    // Get active tags to filter cards
    const activeTagsResult = await StorageManager.getActiveTags();
    const activeTags = activeTagsResult.success ? activeTagsResult.data || [] : [];

    // Get due cards efficiently (only loads cards that are actually due)
    const dueCardsResult = await getDueCardsEfficiently(activeTags, excludeIds);
    if (!dueCardsResult.success) {
      return {
        success: false,
        error: dueCardsResult.error,
      };
    }

    const dueCards = dueCardsResult.data;
    
    if (dueCards.length > 0) {
      // Return the highest priority due card
      const selectedCard = dueCards[0];
      const effectiveDueDate = getEffectiveDueDate(selectedCard);
      const minutesOverdue = Math.round((Date.now() - effectiveDueDate) / (1000 * 60));
      
      // Handle cloze cards specially
      if (selectedCard.type === 'cloze' && selectedCard.clozeDeletions) {
        // Find the most overdue cloze deletion
        const now = Date.now();
        const dueDeletions = selectedCard.clozeDeletions.filter(deletion => 
          deletion.algorithm.dueDate <= now
        );
        
        if (dueDeletions.length > 0) {
          // Sort by how overdue they are (most overdue first)
          dueDeletions.sort((a, b) => a.algorithm.dueDate - b.algorithm.dueDate);
          const selectedDeletion = dueDeletions[0];
          
          // Render the masked text directly (avoid imports in service worker)
          const maskedText = renderClozeWithMaskInBackground(selectedCard.clozeSource || selectedCard.front, selectedDeletion.id);
          
          // Return a modified card with cloze-specific data
          return {
            success: true,
            card: {
              ...selectedCard,
              front: maskedText,
              back: selectedDeletion.text,
              currentDeletion: selectedDeletion,
              algorithm: selectedDeletion.algorithm // Use the deletion's algorithm state
            },
            debug: {
              algorithmState: {
                interval: selectedDeletion.algorithm.interval,
                ease: selectedDeletion.algorithm.ease,
                repetitions: selectedDeletion.algorithm.repetitions,
                dueDate: new Date(selectedDeletion.algorithm.dueDate).toISOString(),
                minutesOverdue: Math.round((now - selectedDeletion.algorithm.dueDate) / (1000 * 60)),
                nextDueDateAfterGood: new Date(now + (selectedDeletion.algorithm.interval * selectedDeletion.algorithm.ease * 24 * 60 * 60 * 1000)).toISOString()
              },
              selectionReason: `Cloze deletion ${selectedDeletion.id} - overdue by ${Math.round((now - selectedDeletion.algorithm.dueDate) / (1000 * 60))} minutes`,
              totalDueCards: dueCards.length,
              clozeDeletionId: selectedDeletion.id
            }
          };
        }
      }
      
      return {
        success: true,
        card: selectedCard,
        debug: {
          algorithmState: {
            interval: selectedCard.algorithm.interval,
            ease: selectedCard.algorithm.ease,
            repetitions: selectedCard.algorithm.repetitions,
            dueDate: new Date(selectedCard.algorithm.dueDate).toISOString(),
            minutesOverdue: minutesOverdue,
            nextDueDateAfterGood: new Date(Date.now() + (selectedCard.algorithm.interval * selectedCard.algorithm.ease * 24 * 60 * 60 * 1000)).toISOString()
          },
          selectionReason: `Due card - overdue by ${minutesOverdue} minutes`,
          totalDueCards: dueCards.length
        }
      };
    }

    // No due cards - return special response to indicate all cards are up to date
    // Check if there are any cards at all
    const upcomingCardsResult = await getUpcomingCardsEfficiently(activeTags, excludeIds, 1);
    
    if (!upcomingCardsResult.success || upcomingCardsResult.data.length === 0) {
      // No cards exist - suggest adding cards
      return {
        success: true,
        noDueCards: true,
        noCardsExist: true,
        message: 'No cards available. Add some cards to start learning!',
        debug: {
          selectionReason: 'No cards exist in the system',
          totalDueCards: 0,
          totalCards: 0
        }
      };
    }

    // Cards exist but none are due - congratulations!
    const nextCard = upcomingCardsResult.data[0];
    const diff = getEffectiveDueDate(nextCard) - Date.now();
    
    // Use the same calculation as the UI to ensure consistency
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
    
    let timeUntilNextText = '';
    if (days > 0) {
      timeUntilNextText = `${days} day${days === 1 ? '' : 's'}`;
    } else if (hours > 0) {
      timeUntilNextText = `${hours} hour${hours === 1 ? '' : 's'}`;
    } else if (minutes > 0) {
      timeUntilNextText = `${minutes} minute${minutes === 1 ? '' : 's'}`;
    } else {
      timeUntilNextText = 'less than a minute';
    }

    // Check if we should show a celebratory toast for this domain
    const shouldShowToast = await DailyToastTracker.shouldShowToast(domain);
    
    return {
      success: true,
      noDueCards: true,
      noCardsExist: false,
      message: `🎉 Great job! All cards are up to date. Next card due in ${timeUntilNextText}.`,
      nextDueIn: minutes,
      shouldShowToast,
      debug: {
        algorithmState: {
          interval: nextCard.algorithm.interval,
          ease: nextCard.algorithm.ease,
          repetitions: nextCard.algorithm.repetitions,
          dueDate: new Date(nextCard.algorithm.dueDate).toISOString(),
          minutesUntilDue: minutes
        },
        selectionReason: `No cards due - next card in ${timeUntilNextText}`,
        totalDueCards: 0,
        shouldShowToast
      }
    };
  } catch (error) {
    console.error('Error getting card with spaced repetition:', error);
    return {
      success: false,
      error: `Failed to get card: ${error}`,
    };
  }
}

async function getDueCardsEfficiently(activeTags: string[], excludeIds: string[]): Promise<{ success: boolean; data: Card[]; error?: string }> {
  try {
    const now = Date.now();
    
    const result = await indexedDBManager.getDueCardsByTags(activeTags, excludeIds);
    
    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'No cards available',
        data: [],
      };
    }

    const dueCards: Card[] = result.data;
    
    // Ensure algorithm metadata and validate
    for (const card of dueCards) {
      if (card.type === 'cloze' && card.clozeDeletions) {
        for (const deletion of card.clozeDeletions) {
          if (!deletion.algorithm) {
            deletion.algorithm = SpacedRepetitionEngine.initializeNewCard();
          } else {
            deletion.algorithm = SpacedRepetitionEngine.validateAlgorithmData(deletion.algorithm);
          }
        }
      } else {
        if (!card.algorithm) {
          card.algorithm = SpacedRepetitionEngine.initializeNewCard();
        } else {
          card.algorithm = SpacedRepetitionEngine.validateAlgorithmData(card.algorithm);
        }
      }
    }
    
    // Sort by priority (overdue first, then by interval)
    dueCards.sort((a, b) => {
      // Get the earliest due date for each card
      const getEarliestDueDate = (card: Card): number => {
        if (card.type === 'cloze' && card.clozeDeletions) {
          const dueDeletions = card.clozeDeletions.filter(d => 
            d.algorithm.dueDate <= now
          );
          if (dueDeletions.length === 0) return Infinity;
          return Math.min(...dueDeletions.map(d => d.algorithm.dueDate));
        }
        return card.algorithm.dueDate;
      };
      
      const aDue = getEarliestDueDate(a);
      const bDue = getEarliestDueDate(b);
      
      if (aDue !== bDue) {
        return aDue - bDue; // Earlier due date first
      }
      
      // For tie-breaking, use the shortest interval
      const getShortestInterval = (card: Card): number => {
        if (card.type === 'cloze' && card.clozeDeletions) {
          const dueDeletions = card.clozeDeletions.filter(d => 
            d.algorithm.dueDate <= now
          );
          if (dueDeletions.length === 0) return Infinity;
          return Math.min(...dueDeletions.map(d => d.algorithm.interval));
        }
        return card.algorithm.interval;
      };
      
      return getShortestInterval(a) - getShortestInterval(b); // Shorter interval first
    });
    
    return {
      success: true,
      data: dueCards,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get due cards: ${error}`,
      data: [],
    };
  }
}

/**
 * Efficiently get upcoming cards (not yet due)
 */
async function getUpcomingCardsEfficiently(activeTags: string[], excludeIds: string[], limit: number): Promise<{ success: boolean; data: Card[]; error?: string }> {
  try {
    const now = Date.now();
    const allCardsResult = await StorageManager.getAllCards();
    
    if (!allCardsResult.success || !allCardsResult.data) {
      return {
        success: false,
        error: allCardsResult.error || 'No cards available',
        data: [],
      };
    }

    // Filter and process cards in a single pass
    const upcomingCards: Card[] = [];
    
    for (const card of Object.values(allCardsResult.data)) {
      // Skip excluded cards
      if (excludeIds.includes(card.id)) {
        continue;
      }
      
      // Skip draft cards - they should not appear in study sessions
      if (card.isDraft) {
        continue;
      }
      
      // Skip cards that don't match active tags (if any are set)
      if (activeTags.length > 0 && !card.tags.some(tag => activeTags.includes(tag))) {
        continue;
      }
      
      // Ensure algorithm metadata exists
      if (!card.algorithm) {
        card.algorithm = SpacedRepetitionEngine.initializeNewCard();
      } else {
        card.algorithm = SpacedRepetitionEngine.validateAlgorithmData(card.algorithm);
      }
      
      // Only upcoming cards (not yet due)
      if (getEffectiveDueDate(card) > now) {
        upcomingCards.push(card);
      }
    }
    
    // Sort by due date (earliest first)
    upcomingCards.sort((a, b) => getEffectiveDueDate(a) - getEffectiveDueDate(b));
    
    return {
      success: true,
      data: upcomingCards.slice(0, limit),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get upcoming cards: ${error}`,
      data: [],
    };
  }
}

/**
 * Validate user's answer to a card
 */
async function handleValidateAnswer(message: any): Promise<any> {
  try {
    const { answer, card, domain } = message;
    
    if (!card || answer === undefined || answer === null) {
      return {
        correct: false,
        error: 'Missing card or answer',
      };
    }

    let isCorrect = false;

    // Handle validation based on card type
    switch (card.type) {
      case 'basic':
        // Basic/show answer cards: user sees card, reveals answer, then rates difficulty
        // The answer value will be 'shown' when user has seen the answer
        isCorrect = (answer === 'shown');
        break;

      case 'cloze':
        // Cloze deletion: check if user's answer matches the expected deletion text
        // The correct answer should be in card.currentDeletion.text
        const userClozeAnswer = answer.toLowerCase().trim();
        const expectedClozeAnswer = (card.currentDeletion?.text || card.back).toLowerCase().trim();
        
        isCorrect = userClozeAnswer === expectedClozeAnswer ||
                   expectedClozeAnswer.includes(userClozeAnswer) ||
                   userClozeAnswer.includes(expectedClozeAnswer);
        break;

      default:
        isCorrect = false;
        break;
    }

    // Determine the correct answer to show
    let correctAnswerToShow = card.back;
    if (card.type === 'cloze' && card.currentDeletion) {
      correctAnswerToShow = card.currentDeletion.text;
    }

    if (isCorrect) {
      // Answer is correct - but don't unblock domain yet, wait for difficulty feedback
      // Log the successful response without difficulty (will be updated later)
      await logCardResponse(card.id, answer, true, domain);
      
      return {
        correct: true,
        correctAnswer: correctAnswerToShow,
        message: 'Correct answer - provide difficulty feedback to unblock domain'
      };
    } else {
      // Log the incorrect response
      await logCardResponse(card.id, answer, false, domain);
      
      return {
        correct: false,
        correctAnswer: correctAnswerToShow
      };
    }
  } catch (error) {
    return {
      correct: false,
      error: `Answer validation failed: ${error}`
    };
  }
}

/**
 * Handle legacy answer submission (for backward compatibility)
 */
async function handleAnswerSubmitted(message: any): Promise<any> {
  try {
    const { answer, domain } = message;
    
    
    
    // For now, just log the submission
    // In the future, this could be enhanced to handle specific validation logic
    
    return {
      success: true,
      message: 'Answer logged successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to handle answer submission: ${error}`,
    };
  }
}

/**
 * Update the last unblock time for a domain
 */
async function updateDomainUnblockTime(domain: string): Promise<void> {
  try {
    // Create variations of the domain to update (same as domain check)
    const normalizedDomain = domain.replace(/^www\./, '');
    const domainVariations = [
      domain,
      normalizedDomain,
      domain.startsWith('www.') ? domain : `www.${domain}`,
    ];
    
    let domainSettings = null;
    let matchedDomain = null;
    
    // Try to update each variation that exists in storage
    for (const variant of domainVariations) {
      const domainResult = await StorageManager.getDomain(variant);
      if (domainResult.success && domainResult.data && domainResult.data.isActive) {
        const updatedSettings = {
          ...domainResult.data,
          lastUnblock: Date.now(),
        };
        
        await StorageManager.setDomain(variant, updatedSettings);
        domainSettings = updatedSettings;
        matchedDomain = variant;
        break; // Only update the first match
      }
    }
    
    // If subdomain not found, try parent domain (web.telegram.org -> telegram.org)
    if (!domainSettings) {
      const parts = normalizedDomain.split('.');
      if (parts.length > 2) {
        const parentDomain = parts.slice(-2).join('.'); // Get telegram.org from web.telegram.org
        const domainResult = await StorageManager.getDomain(parentDomain);
        if (domainResult.success && domainResult.data && domainResult.data.isActive) {
          const updatedSettings = {
            ...domainResult.data,
            lastUnblock: Date.now(),
          };
          
          await StorageManager.setDomain(parentDomain, updatedSettings);
          domainSettings = updatedSettings;
          matchedDomain = parentDomain;
        }
      }
    }
    
    // CRITICAL: Update blocking rules to reflect the cooldown change
    await updateBlockingRules();
    
    // Schedule re-blocking when cooldown expires (solves SPA + timing issues)
    // Use matched domain (parent domain) for scheduling, not the subdomain
    if (domainSettings && domainSettings.cooldownPeriod > 0) {
      await scheduleDomainReblock(matchedDomain || domain, domainSettings.cooldownPeriod);
    }

    // Track domain blocking statistics
    try {
      if (domainSettings) {
        // Calculate time saved (cooldown period in milliseconds)
        const timeSaved = domainSettings.cooldownPeriod * 60 * 1000;
        const statsResult = await StatisticsEngine.updateDomainBlockingStats(matchedDomain || domain, timeSaved);
        if (!statsResult.success) {
          console.error('Failed to update domain blocking statistics:', statsResult.error);
        }
      }
    } catch (error) {
      console.error('Error updating domain blocking statistics:', error);
    }
    
    // Find all tabs with this domain and clear blocking indicators + remove overlays
    // Use the matched domain (parent domain if subdomain was used) to unblock all related tabs
    const domainToUnblock = matchedDomain || domain;
    
    if (extensionCapabilities?.apis?.tabs) {
      try {
        // Query multiple URL patterns to catch all variations including subdomains
        const urlPatterns = [
          `*://${domainToUnblock}/*`,
          `*://www.${domainToUnblock}/*`,
          `*://*.${domainToUnblock}/*`,  // Subdomains like web.telegram.org
          `https://${domainToUnblock}/*`,
          `http://${domainToUnblock}/*`
        ];
        
        let allTabs: chrome.tabs.Tab[] = [];
        
        // Query tabs with different patterns
        for (const pattern of urlPatterns) {
          try {
            const tabs = await SafeAPIWrapper.queryTabs({ url: pattern });
            allTabs = allTabs.concat(tabs);
          } catch (error) {
            // Silently continue with other patterns
          }
        }
        
        // Remove duplicates based on tab ID
        let uniqueTabs = allTabs.filter((tab, index, array) => 
          array.findIndex(t => t.id === tab.id) === index
        );
        
        // Fallback: if no tabs found with URL patterns, manually check all tabs
        if (uniqueTabs.length === 0) {
          try {
            const normalizedDomain = domainToUnblock.replace(/^www\./, '');
            const fallbackTabs = await chrome.tabs.query({});
            for (const tab of fallbackTabs) {
              if (tab.url) {
                try {
                  const tabUrl = new URL(tab.url);
                  const tabDomain = tabUrl.hostname.replace(/^www\./, '');
                  
                  // Check if tab domain matches exactly or is a subdomain
                  if (tabDomain === normalizedDomain || tabDomain.endsWith(`.${normalizedDomain}`)) {
                    uniqueTabs.push(tab);
                  }
                } catch (urlError) {
                  // Invalid URL, skip
                }
              }
            }
          } catch (error) {
            // Silently handle fallback errors
          }
        }
        
        for (const tab of uniqueTabs) {
          if (tab.id && tab.url) {
            await handleUnblockedDomainTab(tab.id, domain);
            
            // Try sending message to content script first
            const messageSent = await new Promise<boolean>((resolve) => {
              chrome.tabs.sendMessage(tab.id!, {
                type: 'DOMAIN_UNBLOCKED',
                domain: domain
              }, (response) => {
                resolve(!chrome.runtime.lastError);
              });
            });
            
            // If message failed, inject content script for old tabs then send message again
            if (!messageSent && extensionCapabilities?.apis?.scripting && 
                !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
              try {
                // Inject the full content script so tab will work properly going forward
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ['contentScript.js']
                });
                
                // Wait for script to initialize
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Send the unblock message to the newly loaded content script
                chrome.tabs.sendMessage(tab.id, {
                  type: 'DOMAIN_UNBLOCKED',
                  domain: domain
                }, () => {
                  // Ignore errors
                });
              } catch (injectError) {
                // Silently fail - tab might not be injectable
              }
            }
          }
        }
      } catch (error) {
        // Silently handle errors
      }
    }
  } catch (error) {
    console.error('Failed to update domain unblock time:', error);
  }
}

/**
 * Log a card response
 */
async function logCardResponse(cardId: string, answer: string, correct: boolean, domain: string): Promise<void> {
  try {
    const studySession = {
      cardId,
      timestamp: Date.now(),
      difficulty: correct ? ('good' as const) : ('again' as const),
      responseTime: 5000, // Default response time - could be enhanced to track actual time
      wasCorrect: correct,
    };
    
    const result = await StorageManager.addResponse(studySession);
    if (!result.success) {
      console.error('Failed to log card response:', result.error);
    }
  } catch (error) {
    console.error('Error logging card response:', error);
  }
}

/**
 * Handle logging card response with difficulty feedback and update spaced repetition scheduling
 */
async function handleLogCardResponse(message: any): Promise<any> {
  try {
    const { cardId, answer, correct, difficulty, domain, currentDeletion } = message;
    
    if (!cardId || !difficulty) {
      return {
        success: false,
        error: 'Missing cardId or difficulty',
      };
    }

    // Get the card to update its algorithm data
    const cardResult = await StorageManager.getCard(cardId);
    if (!cardResult.success || !cardResult.data) {
      return {
        success: false,
        error: 'Card not found',
      };
    }

    const card = cardResult.data;
    let newAlgorithmData;
    let updateData: any = { modified: Date.now() };

    // Handle cloze cards specially
    if (card.type === 'cloze' && currentDeletion && card.clozeDeletions) {
      // Find the specific cloze deletion
      const deletionIndex = card.clozeDeletions.findIndex(d => d.id === currentDeletion.id);
      if (deletionIndex === -1) {
        return {
          success: false,
          error: 'Cloze deletion not found',
        };
      }

      // Ensure deletion has algorithm metadata
      const deletion = card.clozeDeletions[deletionIndex];
      if (!deletion.algorithm) {
        deletion.algorithm = SpacedRepetitionEngine.initializeNewCard();
      } else {
        deletion.algorithm = SpacedRepetitionEngine.validateAlgorithmData(deletion.algorithm);
      }

      // Calculate next scheduling for this specific deletion
      // Create a minimal card object with just the algorithm for calculation
      const deletionAsCard = {
        algorithm: deletion.algorithm,
        // Add minimal required fields to satisfy the interface
        id: `${cardId}-c${deletion.id}`,
        front: deletion.text,
        back: deletion.text,
        type: 'basic' as const,
        tags: card.tags || [],
        created: card.created || Date.now(),
        modified: Date.now(),
        isDraft: false
      };
      newAlgorithmData = SpacedRepetitionEngine.calculateNext(deletionAsCard, difficulty);
      
      // Update the specific deletion's algorithm
      const updatedDeletions = [...card.clozeDeletions];
      updatedDeletions[deletionIndex] = {
        ...deletion,
        algorithm: newAlgorithmData
      };
      
      updateData.clozeDeletions = updatedDeletions;
    } else {
      // Regular card handling
      // Ensure card has algorithm metadata
      if (!card.algorithm) {
        card.algorithm = SpacedRepetitionEngine.initializeNewCard();
      } else {
        card.algorithm = SpacedRepetitionEngine.validateAlgorithmData(card.algorithm);
      }

      // Calculate next scheduling based on difficulty feedback
      newAlgorithmData = SpacedRepetitionEngine.calculateNext(card, difficulty);
      updateData.algorithm = newAlgorithmData;
    }
    
    // Update the card with new algorithm data
    const updateResult = await StorageManager.updateCard(cardId, updateData);

    if (!updateResult.success) {
      console.error('Failed to update card algorithm data:', updateResult.error);
    } else {
      const daysUntilDue = Math.round((newAlgorithmData.dueDate - Date.now()) / (1000 * 60 * 60 * 24));
      const hoursUntilDue = Math.round((newAlgorithmData.dueDate - Date.now()) / (1000 * 60 * 60));
      

    }

    // Log the study session response
    const studySession = {
      cardId,
      timestamp: Date.now(),
      difficulty: difficulty as 'again' | 'hard' | 'good' | 'easy',
      responseTime: 5000, // Default response time - could be enhanced to track actual time
      wasCorrect: correct,
    };
    
    const responseResult = await StorageManager.addResponse(studySession);
    if (!responseResult.success) {
      console.error('Failed to log study session:', responseResult.error);
    }

    // Update statistics tracking
    try {
      const statsResult = await StatisticsEngine.updateDailyStats(studySession, card.tags);
      if (!statsResult.success) {
        console.error('Failed to update statistics:', statsResult.error);
      } else {
        // Update extension badge since streak might have changed
        await updateExtensionBadge();
      }
    } catch (error) {
      console.error('Error updating statistics:', error);
    }

    // Update domain unblock time after any difficulty feedback (correct or incorrect)
    await updateDomainUnblockTime(domain);
    
    // Add a small delay to ensure tab state is updated
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      message: 'Response logged and scheduling updated successfully',
      algorithmData: newAlgorithmData
    };
  } catch (error) {
    console.error('Error in handleLogCardResponse:', error);
    return {
      success: false,
      error: `Failed to log card response: ${error}`,
    };
  }
}

/**
 * Handle getting count of due cards for study session
 */
async function handleGetDueCardsCount(message: any): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // Get active tags to filter cards
    const activeTagsResult = await StorageManager.getActiveTags();
    const activeTags = activeTagsResult.success ? activeTagsResult.data || [] : [];

    // Get due cards efficiently
    const dueCardsResult = await getDueCardsEfficiently(activeTags, []);
    if (!dueCardsResult.success) {
      return {
        success: false,
        error: dueCardsResult.error,
      };
    }

    const dueCards = dueCardsResult.data || [];
    
    return {
      success: true,
      count: dueCards.length,
    };
  } catch (error) {
    console.error('Error getting due cards count:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get due cards count',
    };
  }
}

/**
 * Handle getting next occurrence times for all difficulty levels
 */
async function handleGetNextOccurrences(message: any): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!message.card) {
      return { success: false, error: 'Card is required' };
    }

    const card = message.card;
    
    // Ensure card has proper algorithm data
    if (!card.algorithm) {
      card.algorithm = SpacedRepetitionEngine.initializeNewCard();
    } else {
      card.algorithm = SpacedRepetitionEngine.validateAlgorithmData(card.algorithm);
    }

    // Calculate next occurrence times for all difficulty levels
    const occurrences = SpacedRepetitionEngine.calculateNextOccurrences(card);

    return { success: true, data: occurrences };
  } catch (error) {
    console.error('❌ Error calculating next occurrences:', error);
    return { success: false, error: 'Failed to calculate next occurrences' };
  }
}

/**
 * Check if TTS should be enabled for this card based on its tags
 */
async function handleCheckTTSForCard(message: any): Promise<{ success: boolean; enabled?: boolean; ttsTag?: string; cardSide?: string; error?: string }> {
  try {
    const card = message.card;
    
    if (!card || !card.tags || !Array.isArray(card.tags)) {
      return { success: true, enabled: false };
    }

    const ttsKeyStorage = TTSKeyStorage.getInstance();
    const settings = await ttsKeyStorage.getSettings();
    
    if (!settings || !settings.keys[settings.provider]) {
      return { success: true, enabled: false };
    }

    const enabledTags = settings.enabledTags || [];
    
    // Find the first matching TTS-enabled tag
    const ttsTag = card.tags.find((tag: string) => enabledTags.includes(tag));
    
    if (!ttsTag) {
      return { success: true, enabled: false };
    }
    
    // Get the cardSide setting from the tag config
    const tagConfig = await ttsKeyStorage.getTagConfig(ttsTag);
    const cardSide = tagConfig?.cardSide || 'back';
    
    return { 
      success: true, 
      enabled: true,
      ttsTag: ttsTag,
      cardSide: cardSide
    };
  } catch (error) {
    console.error('Error checking TTS for card:', error);
    return { success: false, error: 'Failed to check TTS availability' };
  }
}

/**
 * Synthesize TTS audio for the given text
 */
async function handleSynthesizeTTS(message: any): Promise<{ success: boolean; audio?: ArrayBuffer; cached?: boolean; error?: string }> {
  try {
    const { text, cardId, ttsTag } = message;
    
    if (!text) {
      return { success: false, error: 'Text is required' };
    }

    const ttsService = TTSService.getInstance();
    const ttsKeyStorage = TTSKeyStorage.getInstance();
    
    // Get tag-specific configuration
    let language = 'en-US';
    let model: string | undefined;
    let voice: string | undefined;
    
    if (ttsTag) {
      const tagConfig = await ttsKeyStorage.getTagConfig(ttsTag);
      
      if (tagConfig && tagConfig.language) {
        language = tagConfig.language;
        model = tagConfig.model;
        voice = tagConfig.voice || undefined; // Empty string -> undefined
        
        // If no voice specified but we have language and model, get first available voice
        if (!voice && model) {
          try {
            const voices = await ttsService.getAvailableVoices(language);
            const matchingVoice = voices.find(v => v.model === model);
            if (matchingVoice) {
              voice = matchingVoice.id;
            }
          } catch (error) {
            console.error('[TTS] Failed to auto-select voice:', error);
          }
        }
      }
    }
    
    const result = await ttsService.synthesize({
      text,
      language,
      voice,
      model
    });
    
    if (!result.success || !result.audio) {
      return { success: false, error: result.error || 'Failed to synthesize audio' };
    }

    // Convert ArrayBuffer to array for message passing
    const audioArray = Array.from(new Uint8Array(result.audio));
    
    return {
      success: true,
      audio: audioArray as any,
      cached: result.cached
    };
  } catch (error) {
    console.error('Error synthesizing TTS:', error);
    return { success: false, error: `TTS synthesis failed: ${error}` };
  }
}

/**
 * Handle getting media data from IndexedDB
 * Returns raw data that the page can convert to a blob URL
 */
async function handleGetMediaUrl(message: any): Promise<{ success: boolean; data?: number[]; mimeType?: string; error?: string }> {
  try {
    const { mediaId } = message;
    
    if (!mediaId) {
      return { success: false, error: 'Media ID is required' };
    }

    // Direct IndexedDB access - no module imports to avoid DOM dependencies
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RekapuDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const media = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const request = tx.objectStore('media').get(mediaId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (media && media.data) {
      // Convert Blob to ArrayBuffer, then to array for message passing
      const arrayBuffer = await media.data.arrayBuffer();
      const dataArray = Array.from(new Uint8Array(arrayBuffer));
      return { success: true, data: dataArray, mimeType: media.mimeType };
    } else {
      return { success: false, error: 'Media not found' };
    }
  } catch (error) {
    console.error('Error getting media data:', error);
    return { success: false, error: `Failed to get media: ${error}` };
  }
}

/**
 * Handle opening the extension popup
 */
async function handleOpenPopup(message: any): Promise<any> {
  try {
    // Try to open the extension popup/options page
    if (chrome.action?.openPopup) {
      await chrome.action.openPopup();
    } else if (chrome.tabs?.create) {
      // Fallback: open the popup in a new tab
      await chrome.tabs.create({
        url: chrome.runtime.getURL('popup.html'),
      });
    } else {
      return {
        success: false,
        error: 'Cannot open popup - insufficient permissions',
      };
    }

    return {
      success: true,
      message: 'Popup opened successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to open popup: ${error}`,
    };
  }
}

/**
 * Handle force unblocking a domain (for no-cards scenario)
 */
async function handleForceUnblockDomain(message: any): Promise<any> {
  try {
    const { domain } = message;
    
    if (!domain) {
      return {
        success: false,
        error: 'Missing domain',
      };
    }

    // Update the domain's unblock time to allow immediate access
    await updateDomainUnblockTime(domain);

    return {
      success: true,
      message: `Domain ${domain} has been unblocked`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to force unblock domain: ${error}`,
    };
  }
}

/**
 * Handle getting the original URL for a blocked domain
 */
async function handleGetOriginalUrl(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  try {
    const { domain, tabId } = message;
    
    // First try to get tab-specific URL using sender's tab ID
    const senderTabId = sender.tab?.id;
    if (senderTabId && originalUrlByTabMap.has(senderTabId)) {
      const originalUrl = originalUrlByTabMap.get(senderTabId);
      // Clean up this tab's URL since the user manually navigated from this tab
      originalUrlByTabMap.delete(senderTabId);
      return { 
        success: true, 
        originalUrl: originalUrl,
        domain: domain
      };
    }
    
    // Second try using passed tabId if provided
    if (tabId && originalUrlByTabMap.has(tabId)) {
      const originalUrl = originalUrlByTabMap.get(tabId);
      return { 
        success: true, 
        originalUrl: originalUrl,
        domain: domain
      };
    }
    
    // Fall back to domain-wide URL
    const originalUrl = originalUrlMap.get(domain);
    
    if (originalUrl) {
      // Clear the stored URL after retrieving it to prevent memory buildup
      originalUrlMap.delete(domain);
      return { 
        success: true, 
        originalUrl: originalUrl,
        domain: domain
      };
    } else {
      // Fallback to root domain if no original URL was captured
      const fallbackUrl = `https://${domain}`;
      return { 
        success: true, 
        originalUrl: fallbackUrl,
        domain: domain
      };
    }
  } catch (error) {
    console.error('Error getting original URL:', error);
    return { 
      success: false, 
      error: `Failed to get original URL: ${error}`,
      originalUrl: `https://${message.domain}` // Fallback
    };
  }
}



// Enhanced tab update listener for additional blocking layer
if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only process when URL changes and is loading/complete
    if (changeInfo.url || (changeInfo.status === 'loading' && tab.url)) {
      try {
        const url = new URL(tab.url!);
        const domain = url.hostname;
        
        // Skip chrome:// and extension:// URLs
        if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
          return;
        }
        

        
        // Check if this domain should be blocked (regardless of cache)
        const domainResult = await StorageManager.getDomain(domain);
        if (domainResult.success && domainResult.data && domainResult.data.isActive) {
          const now = Date.now();
          const timeSinceLastUnblock = now - domainResult.data.lastUnblock;
          const cooldownMs = domainResult.data.cooldownPeriod * 60 * 1000;
          const isNeverUnblocked = domainResult.data.lastUnblock === 0;
          const isInCooldown = timeSinceLastUnblock < cooldownMs;
          const shouldBeBlocked = isNeverUnblocked || !isInCooldown;
          
          if (shouldBeBlocked) {
            // Domain should be blocked - ensure blocking rules are in place
            await updateBlockingRules();
          }
        }
      } catch (error) {
        console.error('Error processing tab update:', error);
      }
    }
  });
} else {
  console.warn('tabs API not available - tab monitoring disabled');
}

// Add tab close listener to clean up tab-specific URLs
if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // Clean up tab-specific original URL to prevent memory leaks
    originalUrlByTabMap.delete(tabId);
  });
}

// Add webNavigation listener to capture original URLs before redirect
if (chrome.webNavigation?.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only process main frame navigations
    if (details.frameId !== 0 || !details.url) {
      return;
    }
    
    try {
      const url = new URL(details.url);
      const fullHostname = url.hostname; // Keep full hostname like web.telegram.org
      const normalizedDomain = url.hostname.replace(/^www\./, ''); // Remove only www.
      
      // Skip chrome:// and extension:// URLs
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        return;
      }
      
      // Check if this domain or its parent domain is blocked
      let domainToCheck = normalizedDomain;
      let domainResult = await StorageManager.getDomain(domainToCheck);
      
      // If subdomain not found, try parent domain (web.telegram.org -> telegram.org)
      if (!domainResult.success || !domainResult.data || !domainResult.data.isActive) {
        const parts = normalizedDomain.split('.');
        if (parts.length > 2) {
          const parentDomain = parts.slice(-2).join('.'); // Get telegram.org from web.telegram.org
          domainResult = await StorageManager.getDomain(parentDomain);
          if (domainResult.success && domainResult.data && domainResult.data.isActive) {
            domainToCheck = parentDomain; // Use parent domain for storage key
          }
        }
      }
      
      if (domainResult.success && domainResult.data && domainResult.data.isActive) {
        const now = Date.now();
        const timeSinceLastUnblock = now - domainResult.data.lastUnblock;
        const cooldownMs = domainResult.data.cooldownPeriod * 60 * 1000;
        const isNeverUnblocked = domainResult.data.lastUnblock === 0;
        const isInCooldown = timeSinceLastUnblock < cooldownMs;
        const shouldBeBlocked = isNeverUnblocked || !isInCooldown;
        
        if (shouldBeBlocked) {
          // Store the original URL with FULL hostname (web.telegram.org) but use parent domain as key
          originalUrlMap.set(domainToCheck, details.url);
          if (details.tabId) {
            originalUrlByTabMap.set(details.tabId, details.url);
          }
        }
      }
    } catch (error) {
      console.error('Error processing navigation for URL capture:', error);
    }
  });
} else {
  console.warn('webNavigation API not available - original URL preservation disabled');
}

// Map to track original URLs for blocked domains (for redirect preservation)
const originalUrlMap = new Map<string, string>(); // domain -> URL (for backward compatibility)
const originalUrlByTabMap = new Map<number, string>(); // tabId -> original URL

/**
 * Set an alarm for when a domain's cooldown expires and it should be re-blocked
 */
async function scheduleDomainReblock(domain: string, cooldownMinutes: number): Promise<void> {
  // Clear any existing alarm for this domain
  const alarmName = `reblock-${domain}`;
  await chrome.alarms.clear(alarmName);

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const when = Date.now() + cooldownMs;

  // Create the alarm
  await chrome.alarms.create(alarmName, { when });
  domainCooldownAlarms.add(domain);
}

/**
 * Show overlays on existing tabs without refreshing when domain becomes blocked again
 */
async function showOverlaysOnDomainTabs(domain: string): Promise<void> {
  if (!chrome.tabs?.query) {
    return;
  }

  try {
    // Try multiple URL patterns to catch all variations including subdomains
    const urlPatterns = [
      `*://${domain}/*`,
      `*://www.${domain}/*`,
      `*://*.${domain}/*`,  // Subdomains like web.telegram.org
      `https://${domain}/*`,
      `http://${domain}/*`,
      `*://${domain}`,      // URLs without trailing slash
      `https://${domain}`,  // HTTPS without trailing slash
      `http://${domain}`    // HTTP without trailing slash
    ];
    
    let allTabs: chrome.tabs.Tab[] = [];
    
    // Query tabs with different patterns
    for (const pattern of urlPatterns) {
      try {
        const tabs = await chrome.tabs.query({ url: pattern });
        allTabs = allTabs.concat(tabs);
      } catch (error) {
        // Silently continue with other patterns
      }
    }
    
    // Remove duplicates based on tab ID
    let uniqueTabs = allTabs.filter((tab, index, array) => 
      array.findIndex(t => t.id === tab.id) === index
    );
    
    // Fallback: if no tabs found with URL patterns, manually check all tabs
    if (uniqueTabs.length === 0) {
      try {
        const fallbackTabs = await chrome.tabs.query({});
        for (const tab of fallbackTabs) {
          if (tab.url) {
            const tabUrl = new URL(tab.url);
            const tabDomain = tabUrl.hostname.replace(/^www\./, '');
            
            // Check if tab domain matches exactly or is a subdomain
            if (tabDomain === domain || tabDomain.endsWith(`.${domain}`)) {
              uniqueTabs.push(tab);
            }
          }
        }
      } catch (error) {
        console.log('Fallback tab search failed:', error);
      }
    }
    
    if (uniqueTabs.length === 0) {
      return;
    }
    
    // Send message to content scripts to re-check domain blocking and show overlay
    for (const tab of uniqueTabs) {
      if (!tab.id || !tab.url) {
        continue;
      }
      
      try {
        // Send message to content script to re-check domain blocking
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECHECK_DOMAIN_BLOCKING'
        }, (response) => {
          // Ignore response errors as content script may not be present
          if (chrome.runtime.lastError) {
            // Content script not available, that's fine
          }
        });
        
        // Brief delay to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        // Ignore errors for tabs that don't have content script
      }
    }
    
  } catch (error) {
    console.error(`Error in showOverlaysOnDomainTabs for ${domain}:`, error);
  }
}

/**
 * Enhanced tab refresh function with multiple approaches for better browser compatibility
 */
async function refreshDomainTabs(domain: string): Promise<void> {
  if (!chrome.tabs?.query) {
    return;
  }

  try {
    // Try multiple URL patterns to catch all variations
    const urlPatterns = [
      `*://${domain}/*`,
      `*://www.${domain}/*`,
      `*://*.${domain}/*`,  // Add subdomain pattern for web.telegram.org etc
      `https://${domain}/*`,
      `http://${domain}/*`
    ];
    
    let allTabs: chrome.tabs.Tab[] = [];
    
    // Query tabs with different patterns
    for (const pattern of urlPatterns) {
      try {
        const tabs = await chrome.tabs.query({ url: pattern });
        allTabs = allTabs.concat(tabs);
      } catch (error) {
        // Silently continue with other patterns
      }
    }
    
    // Remove duplicates based on tab ID
    const uniqueTabs = allTabs.filter((tab, index, array) => 
      array.findIndex(t => t.id === tab.id) === index
    );
    
    if (uniqueTabs.length === 0) {
      return;
    }
    
    // Process each tab with different refresh strategies
    for (const tab of uniqueTabs) {
      if (!tab.id || !tab.url) {
        continue;
      }
      
      try {
        // Primary approach: Hard reload with cache bypass (like CMD+Shift+R)
        await chrome.tabs.reload(tab.id, { bypassCache: true });
        
        // Brief delay to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (reloadError) {
        // Fallback 1: Navigate to blocking page directly
        try {
          const blockingUrl = chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(domain);
          await chrome.tabs.update(tab.id, { url: blockingUrl });
        } catch (updateError) {
          
        }
      }
    }
    
  } catch (error) {
    console.error(`Error in refreshDomainTabs for ${domain}:`, error);
  }
}

/**
 * Refresh all tabs showing blocked pages for a domain back to their original URLs
 */
async function refreshUnblockedDomainTabs(domain: string): Promise<void> {
  if (!chrome.tabs?.query) {
    return;
  }

  try {
    // Find all tabs showing the blocked page for this domain
    const blockedPagePattern = chrome.runtime.getURL('blocked.html') + '*';
    const tabs = await chrome.tabs.query({ url: blockedPagePattern });
    
    for (const tab of tabs) {
      if (!tab.id || !tab.url) {
        continue;
      }
      
      try {
        // Parse the URL to check if it's blocking this specific domain
        const url = new URL(tab.url);
        const blockedParam = url.searchParams.get('blocked');
        
        if (blockedParam === domain) {
          // Get the original URL for this specific tab, or fall back to domain default
          const originalUrl = originalUrlByTabMap.get(tab.id) || originalUrlMap.get(domain) || `https://${domain}`;
          
          // Navigate tab back to original URL
          await chrome.tabs.update(tab.id, { url: originalUrl });
          
          // Clean up the tab-specific URL from memory
          originalUrlByTabMap.delete(tab.id);
          
          // Brief delay to avoid overwhelming the browser
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error processing tab ${tab.id}:`, error);
      }
    }
    
  } catch (error) {
    console.error(`Error in refreshUnblockedDomainTabs for ${domain}:`, error);
  }
}

// Backup periodic check is set up in initializeExtension()

/**
 * Handle blocked domain with comprehensive tab management
 */
async function handleBlockedDomainTab(tabId: number, domain: string, timeRemaining?: number): Promise<void> {
  try {
    // Tab badge removed - keeping only ghost icon
  } catch (error) {
    console.error(`Error handling blocked domain tab ${tabId}:`, error);
  }
}

/**
 * Clean up tab state when domain is unblocked
 */
async function handleUnblockedDomainTab(tabId: number, domain: string): Promise<void> {
  try {
    // Send message to content script to allow navigation
    if (extensionCapabilities?.apis?.tabs) {
      chrome.tabs.sendMessage(tabId, {
        type: 'DOMAIN_UNBLOCKED',
        domain: domain,
      }, (response) => {
        // Ignore response errors as content script may not be present
        if (chrome.runtime.lastError) {
          // Content script not available for unblock message
        }
      });
    }
  } catch (error) {
    console.error(`Error handling unblocked domain tab ${tabId}:`, error);
  }
}

/**
 * Handle backup export operations with progress tracking
 */
async function handleExportBackup(message: any): Promise<any> {
  try {
    const { scope, operationId } = message.data;
    const backupScope = scope as BackupScope;
    
    // Track operation
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'export',
        progress: 0,
        status: 'Starting export...'
      });
    }

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 25, 'Collecting data...');
    }

    const exportBlob = await BackupManager.exportBackup(backupScope);

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 100, 'Export complete');
    }

    // Convert blob to base64 for message passing
    const arrayBuffer = await exportBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    return {
      success: true,
      data: {
        blob: Array.from(uint8Array),
        mimeType: exportBlob.type,
        size: exportBlob.size
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle backup import operations (legacy method)
 */
async function handleImportBackup(message: any): Promise<any> {
  try {
    const { fileData, scope, strategy, operationId } = message.data;
    
    // Track operation
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'import',
        progress: 0,
        status: 'Starting import...'
      });
    }

    // Convert array back to file
    const uint8Array = new Uint8Array(fileData.data);
    const blob = new Blob([uint8Array], { type: fileData.mimeType });
    const file = new File([blob], fileData.name, { type: fileData.mimeType });

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 25, 'Processing backup file...');
    }

    const result = await BackupManager.importBackup(file, scope, strategy);

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 100, 'Import complete');
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle conflict detection for import operations
 */
async function handleDetectConflicts(message: any): Promise<any> {
  try {
    const { fileData, scope, operationId } = message.data;
    
    // Track operation
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'import',
        progress: 0,
        status: 'Detecting conflicts...'
      });
    }

    // Convert array back to file
    const uint8Array = new Uint8Array(fileData.data);
    const blob = new Blob([uint8Array], { type: fileData.mimeType });
    const file = new File([blob], fileData.name, { type: fileData.mimeType });

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 50, 'Analyzing conflicts...');
    }

    const conflicts = await BackupManager.detectImportConflicts(file, scope);

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 100, 'Conflict analysis complete');
    }

    return {
      success: true,
      data: conflicts
    };
  } catch (error) {
    return {
      success: false,
      error: `Conflict detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle import with pre-resolved conflicts
 */
async function handleImportWithResolution(message: any): Promise<any> {
  try {
    const { backupData, scope, conflicts, resolutions, operationId } = message.data;
    
    // Track operation
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'import',
        progress: 0,
        status: 'Importing with conflict resolution...'
      });
    }

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 25, 'Applying conflict resolutions...');
    }

    const result = await BackupManager.importBackupWithConflictResolution(
      backupData,
      scope,
      conflicts,
      resolutions
    );

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 100, 'Import complete');
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: `Import with resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle fast batch import (no conflict resolution, no snapshots)
 */
async function handleImportCardsBatch(message: any): Promise<any> {
  try {
    const { backupData, operationId } = message.data;
    
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'import',
        progress: 0,
        status: 'Importing cards...'
      });
    }

    if (operationId) {
      updateOperationProgress(operationId, 50, 'Saving to database...');
    }

    const result = await BackupManager.importCardsBatch(backupData);

    if (operationId) {
      updateOperationProgress(operationId, 100, 'Import complete');
      activeOperations.delete(operationId);
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: `Batch import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Handle Anki .txt import
 */
async function handleImportAnki(message: any): Promise<any> {
  try {
    const { fileData, strategy, additionalTags = [], operationId } = message.data;
    
    // Track operation
    if (operationId) {
      activeOperations.set(operationId, {
        type: 'anki_import',
        progress: 0,
        status: 'Parsing Anki .txt file...'
      });
    }

    // Convert array back to file
    const uint8Array = new Uint8Array(fileData.data);
    const blob = new Blob([uint8Array], { type: fileData.mimeType });
    const file = new File([blob], fileData.name, { type: fileData.mimeType });

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 20, 'Processing Anki export...');
    }

    const result = await BackupManager.importAnki(file, strategy, additionalTags);

    // Update progress
    if (operationId) {
      updateOperationProgress(operationId, 100, 'Anki import complete');
      // Clean up operation
      activeOperations.delete(operationId);
    }

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: `Anki import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Get progress for an active operation
 */
async function handleGetOperationProgress(message: any): Promise<any> {
  const { operationId } = message.data;
  
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return {
      success: false,
      error: 'Operation not found'
    };
  }

  return {
    success: true,
    data: {
      type: operation.type,
      progress: operation.progress,
      status: operation.status
    }
  };
}

/**
 * Cancel an active operation
 */
async function handleCancelOperation(message: any): Promise<any> {
  const { operationId } = message.data;
  
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return {
      success: false,
      error: 'Operation not found'
    };
  }

  // Note: Operation cancellation can be added here for specific operation types

  // Remove from tracking
  activeOperations.delete(operationId);

  return {
    success: true,
    data: {
      message: 'Operation cancelled'
    }
  };
}

/**
 * Update operation progress and notify listeners
 */
function updateOperationProgress(operationId: string, progress: number, status: string): void {
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return;
  }

  operation.progress = progress;
  operation.status = status;

  // Send progress update to tab if available
  if (operation.tabId && chrome.tabs?.sendMessage) {
    chrome.tabs.sendMessage(operation.tabId, {
      type: 'OPERATION_PROGRESS',
      operationId,
      progress,
      status
    }, () => {
      // Ignore errors (tab might be closed)
      if (chrome.runtime.lastError) {
        // Tab not available
      }
    });
  }

  // Clean up completed operations after a delay
  if (progress >= 100) {
    setTimeout(() => {
      activeOperations.delete(operationId);
    }, 30000); // Keep for 30 seconds after completion
  }
}

/**
 * Get available backup snapshots for recovery
 */
async function handleGetSnapshots(message: any): Promise<any> {
  try {
    const snapshots = await BackupManager.getAvailableSnapshots();
    
    return {
      success: true,
      data: snapshots
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get snapshots: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Restore from a specific snapshot
 */
async function handleRestoreSnapshot(message: any): Promise<any> {
  try {
    const { snapshotId } = message.data;
    
    if (!snapshotId) {
      return {
        success: false,
        error: 'Snapshot ID is required'
      };
    }

    await BackupManager.restoreFromSnapshot(snapshotId);
    
    return {
      success: true,
      data: {
        message: `Successfully restored from snapshot ${snapshotId}`
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Delete a specific snapshot
 */
async function handleDeleteSnapshot(message: any): Promise<any> {
  try {
    const { snapshotId } = message.data;
    
    if (!snapshotId) {
      return {
        success: false,
        error: 'Snapshot ID is required'
      };
    }

    await BackupManager.deleteSnapshot(snapshotId);
    
    return {
      success: true,
      data: {
        message: `Successfully deleted snapshot ${snapshotId}`
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Validate current data integrity
 */
async function handleValidateIntegrity(message: any): Promise<any> {
  try {
    const validation = await BackupManager.validateDataIntegrity();
    
    return {
      success: true,
      data: validation
    };
  } catch (error) {
    return {
      success: false,
      error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

 