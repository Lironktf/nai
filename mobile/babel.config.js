module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // Manually expand nativewind/babel, omitting 'react-native-worklets/plugin'
      // (uninstalled standalone package unconditionally added by react-native-css-interop).
      require('react-native-css-interop/dist/babel-plugin').default,
      [
        '@babel/plugin-transform-react-jsx',
        { runtime: 'automatic', importSource: 'react-native-css-interop' },
      ],
      // Reanimated 3 babel plugin — required for expo-router screen transition animations.
      // Must be last.
      'react-native-reanimated/plugin',
    ],
  };
};
