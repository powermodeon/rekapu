/**
 * Shared constants for the extension and website
 */

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'uk'] as const;
export const DEFAULT_LANGUAGE = 'en' as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

