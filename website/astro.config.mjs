// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../src/config/constants.ts';

// https://astro.build/config
export default defineConfig({
  site: 'https://rekapu.com',
  i18n: {
    defaultLocale: DEFAULT_LANGUAGE,
    locales: [...SUPPORTED_LANGUAGES],
    routing: {
      prefixDefaultLocale: true,
    }
  },
  integrations: [tailwind()],
});