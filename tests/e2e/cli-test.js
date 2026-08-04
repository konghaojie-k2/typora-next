/**
 * E2E CLI Test
 * Tests agent-bridge.mjs (pi kernel) via command line interface
 * No UI, no Rust backend - pure CLI parameter-driven testing.
 * The mock Pi SDK is injected at the ESM import boundary via
 * TYPORA_PI_SDK_ENTRY (same mechanism the Rust host uses for the real SDK).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TestRunner = require('../shared/test-runner');

const BRIDGE_PATH = path.join(__dirname, '..', '..', 'agent-bridge.mjs');
const MOCK_PI_SDK = path.join(__dirname, '..', 'mock-pi-sdk', 'index.mjs');

/**
 * Run agent-bridge.js as CLI and collect output
 */
function runAgentBridge(stage, config, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ config, args });
    const proc = spawn('node', [BRIDGE_PATH, stage, payload], {
      env: {
        ...process.env,
        TYPORA_PI_SDK_ENTRY: MOCK_PI_SDK,
        // Keep the bridge log next to the running test so assertions find it
        TYPORA_NEXT_LOG_DIR: process.cwd()
      }
    });

    const stdout = [];
    const stderr = [];

    proc.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) stdout.push(line.trim());
      });
    });

    proc.stderr.on('data', (data) => {
      stderr.push(data.toString().trim());
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse JSON lines from stdout
 */
function parseEvents(stdout) {
  return stdout.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return { type: 'raw', data: line };
    }
  });
}

// ============================================
// E2E: CLI Parameter-driven Tests
// ============================================

TestRunner.test('E2E: plan stage with CLI returns outline event', async () => {
  const result = await runAgentBridge('plan', {}, {
    goal: '理解 Transformer',
    level: 'intermediate',
    hours: 3
  });

  // With the mock Pi SDK injected, plan must complete and emit the outline
  const events = parseEvents(result.stdout);

  TestRunner.assertEquals(result.code, 0, `plan stage should exit 0 (stderr: ${result.stderr.join(' ')})`);
  TestRunner.assertExists(events.find(e => e.type === 'outline'), 'Should emit outline event');

  // Check log file was created
  TestRunner.assert(fs.existsSync('agent-bridge.log'), 'Should create agent-bridge.log');
});

TestRunner.test('E2E: CLI with invalid JSON args shows error', async () => {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BRIDGE_PATH, 'plan', 'invalid-json']);
    const stdout = [];

    proc.stdout.on('data', (data) => {
      stdout.push(...data.toString().trim().split('\n'));
    });

    proc.on('close', (code) => {
      try {
        TestRunner.assert(code !== 0, 'Should exit with non-zero code');
        const events = parseEvents(stdout);
        const errorEvent = events.find(e => e.type === 'error');
        TestRunner.assertExists(errorEvent, 'Should emit error event');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

TestRunner.test('E2E: CLI with missing stage shows usage error', async () => {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BRIDGE_PATH]);
    const stdout = [];

    proc.stdout.on('data', (data) => {
      stdout.push(...data.toString().trim().split('\n'));
    });

    proc.on('close', (code) => {
      try {
        TestRunner.assert(code !== 0, 'Should exit with error');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

// Run
console.log('Running E2E CLI Tests (pi kernel, mock SDK via TYPORA_PI_SDK_ENTRY)...\n');

TestRunner.run();
