/**
 * Minimal BDD Step Runner
 * Parses Gherkin .feature files and executes matching step definitions
 * No external dependencies - pure Node.js
 */

const fs = require('fs');
const path = require('path');

// Color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/**
 * Parse a .feature file into structured scenarios
 */
function parseFeature(content) {
  const lines = content.split('\n');
  const scenarios = [];
  let currentScenario = null;
  let featureName = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('Feature:')) {
      featureName = line.replace('Feature:', '').trim();
    } else if (line.startsWith('Scenario:')) {
      if (currentScenario) scenarios.push(currentScenario);
      currentScenario = {
        name: line.replace('Scenario:', '').trim(),
        steps: [],
        feature: featureName
      };
    } else if (line.startsWith('Given ') || line.startsWith('When ') || line.startsWith('Then ') || line.startsWith('And ')) {
      if (currentScenario) {
        currentScenario.steps.push({
          keyword: line.split(' ')[0],
          text: line.substring(line.indexOf(' ') + 1)
        });
      }
    }
  }

  if (currentScenario) scenarios.push(currentScenario);
  return scenarios;
}

/**
 * Step definitions registry
 */
class StepRegistry {
  constructor() {
    this.steps = [];
  }

  given(pattern, fn) {
    this.steps.push({ type: 'Given', pattern, fn });
  }

  when(pattern, fn) {
    this.steps.push({ type: 'When', pattern, fn });
  }

  then(pattern, fn) {
    this.steps.push({ type: 'Then', pattern, fn });
  }

  async runStep(stepText, context) {
    for (const step of this.steps) {
      const match = this.matchPattern(step.pattern, stepText);
      if (match) {
        await step.fn.call(context, ...match.slice(1));
        return;
      }
    }
    throw new Error(`No step definition found for: "${stepText}"`);
  }

  matchPattern(pattern, text) {
    // Convert pattern to regex, supporting both English and Chinese quotes
    let regexStr = pattern
      .replace(/\{string\}/g, '[""""]([^""""]+)[""""]')
      .replace(/\{int\}/g, '\\s*(\\d+)\\s*')
      .replace(/\{word\}/g, '(\\S+)');
    regexStr = '^' + regexStr + '$';
    const regex = new RegExp(regexStr);
    return text.match(regex);
  }
}

/**
 * Run all scenarios from feature files
 */
async function runFeatures(featureDir, stepDefs) {
  const files = fs.readdirSync(featureDir).filter(f => f.endsWith('.feature'));
  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(featureDir, file), 'utf-8');
    const scenarios = parseFeature(content);

    console.log(`\n${YELLOW}Feature File: ${file}${RESET}`);

    for (const scenario of scenarios) {
      process.stdout.write(`  ${scenario.name} ... `);

      const context = {};
      try {
        for (const step of scenario.steps) {
          await stepDefs.runStep(step.text, context);
        }
        console.log(`${GREEN}✅ PASS${RESET}`);
        passed++;
      } catch (e) {
        console.log(`${RED}❌ FAIL${RESET}`);
        console.log(`    ${RED}  ${e.message}${RESET}`);
        failed++;
      }
    }
  }

  console.log(`\n${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${passed + failed} total`);
  return { passed, failed };
}

module.exports = { parseFeature, StepRegistry, runFeatures };
