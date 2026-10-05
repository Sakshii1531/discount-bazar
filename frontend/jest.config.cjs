/** Jest config for frontend unit/component tests (Playwright E2E lives in /e2e). */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{js,jsx}'],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  transform: { '^.+\.[jt]sx?$': 'babel-jest' },
  transformIgnorePatterns: ['/node_modules/(?!(jwt-decode)/)'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '\.(css|less|scss)$': 'identity-obj-proxy',
    '\.(png|jpe?g|gif|webp|svg|mp3|mp4|lottie)$': '<rootDir>/test-utils/fileMock.cjs',
  },
  setupFilesAfterEnv: ['<rootDir>/test-utils/setupTests.js'],
  clearMocks: true,
};
