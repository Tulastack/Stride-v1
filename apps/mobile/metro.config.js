// Metro config for this Expo app inside an npm-workspaces monorepo.
//
// SDK 57's expo/metro-config finds the workspace root on its own and resolves
// hoisted packages without help, so the hand-rolled watchFolders /
// nodeModulesPaths / disableHierarchicalLookup block that used to live here is
// gone. That block existed because an older Metro could not see hoisted
// packages (expo-router in particular), and it fell back to expo/AppEntry and
// died on "../../App". Keeping it now would fight the defaults: hierarchical
// lookup off is exactly what expo-doctor flags, and it stops Metro walking up
// to the root node_modules the workspace actually installs into.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
