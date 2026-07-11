// Metro config for this Expo app inside the Turborepo monorepo.
//
// Dependencies are hoisted to the repo-root node_modules (e.g. expo-router),
// which lives outside this app's folder. By default Metro only watches and
// resolves within the project root, so it can't resolve the hoisted
// `expo-router/entry` set as `main` — Expo then falls back to the default
// `expo/AppEntry.js`, which fails on `../../App`. Watching the monorepo root
// and adding both node_modules paths fixes resolution.
//
// See: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo.
config.watchFolders = [monorepoRoot];

// 2. Resolve from the app's own node_modules first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
