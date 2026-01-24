/**
 * Electron Forge Configuration
 *
 * Configures the build and packaging process for the Electron app.
 * Uses Vite plugin for bundling main, preload, and renderer processes.
 */

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'SkilljackClient',
    executableName: 'skilljack-client',
    appBundleId: 'com.skilljack.client',
    icon: './assets/icon', // Will look for icon.icns (macOS), icon.ico (Windows)
    asar: true,
    // Ignore files not needed in the package
    ignore: [
      /^\/src\//,
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/node_modules\/\.cache/,
      /\.ts$/,
      /\.map$/,
      /tsconfig.*\.json$/,
      /\.eslint/,
      /\.prettier/,
    ],
  },

  rebuildConfig: {},

  makers: [
    // Windows installer
    new MakerSquirrel({
      name: 'SkilljackClient',
      setupIcon: './assets/icon.ico',
    }),

    // Cross-platform ZIP (macOS and Linux)
    new MakerZIP({}, ['darwin', 'linux']),

    // Linux .deb package
    new MakerDeb({
      options: {
        name: 'skilljack-client',
        productName: 'Skilljack Client',
        genericName: 'MCP Client',
        description: 'A full-capability MCP client with desktop UI',
        categories: ['Development', 'Utility'],
        icon: './assets/icon.png',
      },
    }),

    // Linux .rpm package
    new MakerRpm({
      options: {
        name: 'skilljack-client',
        productName: 'Skilljack Client',
        genericName: 'MCP Client',
        description: 'A full-capability MCP client with desktop UI',
        categories: ['Development', 'Utility'],
        icon: './assets/icon.png',
      },
    }),
  ],

  plugins: [
    new VitePlugin({
      // Build configuration for different processes
      build: [
        {
          // Main process
          entry: 'src/electron/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          // Preload scripts
          entry: 'src/electron/preload/host.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          // Renderer process (React UI)
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
