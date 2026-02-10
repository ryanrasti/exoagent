/**
 * @type {import('electron-builder').Configuration}
 */
export default {
  appId: 'com.exoagent.app',
  productName: 'ExoAgent',
  directories: {
    output: 'out',
    buildResources: 'resources',
  },
  files: [
    'dist/**/*',
  ],
  extraMetadata: {
    main: 'dist/main/index.cjs',
  },
  mac: {
    target: ['dmg'],
    category: 'public.app-category.productivity',
  },
  win: {
    target: ['nsis'],
  },
  linux: {
    target: ['AppImage'],
    category: 'Utility',
  },
}
