/**
 * Minimal test runner for Vanilla JS TDD
 * No external dependencies - pure JS assertions
 */

const TestRunner = {
  tests: [],
  failures: [],

  test(name, fn) {
    this.tests.push({ name, fn });
  },

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  },

  assertEquals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message || 'Assertion failed') + `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  },

  assertExists(value, message) {
    if (value === null || value === undefined) {
      throw new Error(message || 'Expected value to exist');
    }
  },

  assertThrows(fn, message) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || 'Expected function to throw');
    }
  },

  async run() {
    this.failures = [];
    let passed = 0;
    let failed = 0;

    for (const { name, fn } of this.tests) {
      try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
      } catch (e) {
        failed++;
        this.failures.push({ name, error: e.message });
        console.log(`  ❌ ${name}: ${e.message}`);
      }
    }

    console.log(`\n${passed} passed, ${failed} failed, ${this.tests.length} total`);
    return { passed, failed, total: this.tests.length };
  },

  reset() {
    this.tests = [];
    this.failures = [];
  }
};

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TestRunner;
}
