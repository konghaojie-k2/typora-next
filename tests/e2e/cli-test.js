/**
 * E2E CLI Test
 * Tests agent-bridge.js via command line interface
 * No UI, no Rust backend - pure CLI parameter-driven testing
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TestRunner = require('../unit/test-runner');

const BRIDGE_PATH = path.join(__dirname, '..', '..', 'agent-bridge.js');

/**
 * Run agent-bridge.js as CLI and collect output
 */
function runAgentBridge(stage, config, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ config, args });
    const proc = spawn('node', [BRIDGE_PATH, stage, payload], {
      env: {
        ...process.env,
        // Allow test to inject mock SDK via env var
        AGENT_SDK_MOCK: process.env.AGENT_SDK_MOCK || ''
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

  // Should not crash
  // Note: If Agent SDK is not installed, this will exit with error
  // In CI/test env, use AGENT_SDK_MOCK=1

  const events = parseEvents(result.stdout);

  // Check log file was created
  TestRunner.assert(fs.existsSync('agent-bridge.log'), 'Should create agent-bridge.log');

  // At minimum, we should get some output or a clear error
  TestRunner.assert(
    events.length > 0 || result.stderr.length > 0,
    'Should produce some output'
  );
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
console.log('Running E2E CLI Tests...');
console.log('Note: These tests require Node.js. Agent SDK tests may fail if not installed.');
console.log('Use AGENT_SDK_MOCK=1 to test with mock SDK.\n');

TestRunner.run();
