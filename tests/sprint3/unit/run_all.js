/**
 * Run all Sprint 3 TDD unit tests in sequence
 */
const path = require('path');

async function runOne(label, filePath) {
  console.log(`▶ ${label}`);
  // Clear all test-related cache
  Object.keys(require.cache).forEach(key => {
    if (key.includes('test-runner') ||
        key.includes('test_element_renderer') ||
        key.includes('test_quiz_panel') ||
        key.includes('test_selection_explainer')) {
      delete require.cache[key];
    }
  });
  const T = require(filePath);
  const result = await T.run();
  console.log(`  ${result.passed} passed, ${result.failed} failed, ${result.total} total\n`);
  return result;
}

async function runAll() {
  console.log('═══════════════════════════════════════');
  console.log('  Sprint 3 TDD — Unit Tests');
  console.log('═══════════════════════════════════════\n');

  const r1 = await runOne('Element Renderer', path.join(__dirname, 'test_element_renderer.js'));
  const r2 = await runOne('Quiz Panel', path.join(__dirname, 'test_quiz_panel.js'));
  const r3 = await runOne('Selection Explainer', path.join(__dirname, 'test_selection_explainer.js'));

  const totalPassed = r1.passed + r2.passed + r3.passed;
  const totalFailed = r1.failed + r2.failed + r3.failed;
  const total = r1.total + r2.total + r3.total;

  console.log('═══════════════════════════════════════');
  console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed, ${total} total`);
  console.log('═══════════════════════════════════════');

  process.exit(totalFailed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
