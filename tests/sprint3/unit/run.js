/**
 * Run all Sprint 3 TDD unit tests
 */
const T = require('./test_element_renderer');
T.run().then(result => {
  process.exit(result.failed > 0 ? 1 : 0);
});
