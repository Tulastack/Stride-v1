// Metro config for this Expo app inside an npm-workspaces monorepo.
// Without watchFolders + nodeModulesPaths pointing at the repo root, Metro
// can't resolve hoisted packages (e.g. expo-router), which made Expo fall back
// to its default entry (expo/AppEntry) and fail on "../../App".
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
