/**
 * Run Sprint 3 BDD tests (inner layer)
 */
const path = require('path');
const { runFeatures } = require('./runner');

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  Sprint 3 BDD — Inner Layer');
  console.log('═══════════════════════════════════════\n');

  const featureDir = path.join(__dirname, '../sprint3/features');
  const steps = require('./sprint3_steps');

  const result = await runFeatures(featureDir, steps);

  console.log(`\nResult: ${result.passed} passed, ${result.failed} failed`);
  process.exit(result.failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
