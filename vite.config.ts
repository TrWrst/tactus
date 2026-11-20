/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';

/**
 * `--mode lan`: serve over HTTPS on the local network with the self-signed
 * certificate in .cert/ (see README → "Try it on your phone"). Phones need
 * HTTPS for the microphone.
 */
function lanHttps(mode: string) {
  if (mode !== 'lan') return undefined;
  if (!existsSync(new URL('.cert/key.pem', import.meta.url))) throw new Error('No .cert/key.pem — create the certificate first (see README).');
  return { key: readFileSync(new URL('.cert/key.pem', import.meta.url)), cert: readFileSync(new URL('.cert/cert.pem', import.meta.url)) };
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets TACTUS_BASE.
  base: process.env.TACTUS_BASE || '/',
  server: { https: lanHttps(mode) },
  preview: { https: lanHttps(mode) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png', 'favicon.ico'],
      manifest: {
        name: 'Tactus Metronome',
        short_name: 'Tactus',
        description: 'A precise, practice-focused metronome.',
        theme_color: '#15120f',
        background_color: '#15120f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'] },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
