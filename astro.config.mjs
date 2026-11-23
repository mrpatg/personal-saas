// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  // Astro's built-in sessions are off: auth (Better Auth) keeps its own sessions
  // in D1. Leaving them on adds a KV namespace that breaks preview deploys.
  session: false,
  vite: {
    plugins: [tailwindcss()],
  },
});
