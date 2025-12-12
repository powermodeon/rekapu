/**
 * Default domains loader utility
 * Loads default domains during first installation for testing
 */

import { StorageManager } from '../storage/StorageManager';
import { DomainSettings } from '../types/storage';

const DEFAULT_DOMAINS_LOADED_KEY = 'defaultDomainsLoaded';

/**
 * Default domains to add on first installation
 */
const DEFAULT_DOMAINS: Array<{ domain: string; settings: Omit<DomainSettings, 'domain'> }> = [];

/**
 * Check if default domains have already been loaded
 */
async function haveDefaultDomainsBeenLoaded(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(DEFAULT_DOMAINS_LOADED_KEY);
    return result[DEFAULT_DOMAINS_LOADED_KEY] === true;
  } catch (error) {
    console.error('Error checking default domains loaded status:', error);
    return false;
  }
}

/**
 * Mark default domains as loaded
 */
async function markDefaultDomainsAsLoaded(): Promise<void> {
  try {
    await chrome.storage.local.set({ [DEFAULT_DOMAINS_LOADED_KEY]: true });
  } catch (error) {
    console.error('Error marking default domains as loaded:', error);
  }
}

/**
 * Load default domains into storage on first installation
 * Only loads once - subsequent calls are skipped
 */
export async function loadDefaultDomains(): Promise<{ success: boolean; domainsLoaded: number; error?: string }> {
  try {
    // Check if default domains have already been loaded
    const alreadyLoaded = await haveDefaultDomainsBeenLoaded();
    if (alreadyLoaded) {
      return { success: true, domainsLoaded: 0 };
    }

    let loadedCount = 0;
    for (const { domain, settings } of DEFAULT_DOMAINS) {
      const result = await StorageManager.setDomain(domain, settings);
      
      if (result.success) {
        loadedCount++;
      } else {
        console.error('Failed to add default domain:', result.error);
      }
    }

    // Mark as loaded so we don't load them again
    await markDefaultDomainsAsLoaded();

    return { success: true, domainsLoaded: loadedCount };
    
  } catch (error) {
    console.error('Error loading default domains:', error);
    return { 
      success: false, 
      domainsLoaded: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}