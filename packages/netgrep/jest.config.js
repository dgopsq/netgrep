/* eslint-disable */
export default {
  displayName: 'netgrep',
  preset: '../../jest.preset.js',
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      useESM: true,
    },
  },
  transform: {
    '^.+\\.[tj]s$': 'ts-jest',
  },
  // The Node-target WASM glue is generated CommonJS consumed as-is by the
  // integration tests. Running it through ts-jest gains nothing and warns
  // about `allowJs`.
  transformIgnorePatterns: ['/node_modules/', '/packages/search/pkg-node/'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/netgrep',
};
