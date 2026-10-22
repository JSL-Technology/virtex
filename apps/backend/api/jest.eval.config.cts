/**
 * The AI evaluation run (`npm run ai:eval`): the cases in src/app/ai/evaluation against the real
 * model. Separate from the unit suite because it calls the provider, costs money and needs a key;
 * without ANTHROPIC_API_KEY it skips.
 */
const base = require('./jest.config.cts');

module.exports = {
  ...base,
  displayName: 'api-ai-eval',
  globalSetup: undefined,
  testMatch: ['<rootDir>/src/app/ai/evaluation/**/*.eval.ts'],
};
