#!/usr/bin/env node
'use strict';

const { readFileSync, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');
const { parse, matchOwner, getOwners, matchMany, findUnowned, stats } = require('./index');

function usage() {
  console.log(`Usage: codeowners <command> [options]

Commands:
  whoowns <path>           Show owners for a file path
  check <path>             Check if a path has owners
  unowned [dir]            Find files without owners
  stats [dir]              Show ownership statistics
  validate [file]          Validate CODEOWNERS file syntax

Options:
  -f, --file <path>        Path to CODEOWNERS file (default: auto-detect)
  -j, --json               Output as JSON
  -h, --help               Show this help

Examples:
  codeowners whoowns src/index.js
  codeowners unowned --file .github/CODEOWNERS
  codeowners stats --json
  codeowners validate`);
}

// ─── Arg Parsing ────────────────────────────────────────

const args = process.argv.slice(2);
let command = null;
let targetPath = null;
let codeownersFile = null;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-h' || arg === '--help') {
    usage();
    process.exit(0);
  } else if (arg === '-f' || arg === '--file') {
    codeownersFile = args[++i];
  } else if (arg === '-j' || arg === '--json') {
    jsonOutput = true;
  } else if (!command) {
    command = arg;
  } else if (!targetPath) {
    targetPath = arg;
  }
}

if (!command) {
  usage();
  process.exit(1);
}

// ─── Find CODEOWNERS ────────────────────────────────────

function findCodeownersFile() {
  if (codeownersFile) return codeownersFile;
  const locations = [
    'CODEOWNERS',
    '.github/CODEOWNERS',
    'docs/CODEOWNERS',
  ];
  for (const loc of locations) {
    try {
      readFileSync(loc, 'utf8');
      return loc;
    } catch (e) {
      // continue
    }
  }
  return null;
}

// ─── Walk Directory ─────────────────────────────────────

function walkDir(dir, basePath = '') {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    return results;
  }

  for (const entry of entries) {
    if (entry === '.git' || entry === 'node_modules' || entry === '.svn') continue;
    const fullPath = join(dir, entry);
    const relPath = basePath ? `${basePath}/${entry}` : entry;

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...walkDir(fullPath, relPath));
      } else {
        results.push(relPath);
      }
    } catch (e) {
      // skip
    }
  }
  return results;
}

// ─── Commands ───────────────────────────────────────────

function loadRules() {
  const file = findCodeownersFile();
  if (!file) {
    console.error('Error: No CODEOWNERS file found. Use -f to specify.');
    process.exit(1);
  }

  const content = readFileSync(file, 'utf8');
  const result = parse(content);

  if (result.errors.length > 0 && command === 'validate') {
    // Show errors
  }

  return { file, result };
}

function cmdWhoowns() {
  const { result } = loadRules();
  if (!targetPath) {
    console.error('Error: path required');
    process.exit(1);
  }

  const rule = matchOwner(result.rules, targetPath);
  if (!rule) {
    if (jsonOutput) {
      console.log(JSON.stringify({ path: targetPath, owners: [], matched: false }));
    } else {
      console.log(`No owners for ${targetPath}`);
    }
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      path: targetPath,
      owners: rule.owners,
      matched: true,
      pattern: rule.pattern,
      line: rule.line,
    }));
  } else {
    console.log(`${targetPath}: ${rule.owners.join(', ')}`);
    console.log(`  matched by: ${rule.pattern} (line ${rule.line})`);
  }
}

function cmdCheck() {
  const { result } = loadRules();
  if (!targetPath) {
    console.error('Error: path required');
    process.exit(1);
  }

  const owners = getOwners(result.rules, targetPath);
  if (jsonOutput) {
    console.log(JSON.stringify({ path: targetPath, hasOwners: owners.length > 0, owners }));
  } else {
    if (owners.length > 0) {
      console.log(`✓ ${targetPath} → ${owners.join(', ')}`);
    } else {
      console.log(`✗ ${targetPath} has no owners`);
      process.exit(1);
    }
  }
}

function cmdUnowned() {
  const { result } = loadRules();
  const dir = targetPath || '.';
  const files = walkDir(dir);
  const unowned = findUnowned(result.rules, files);

  if (jsonOutput) {
    console.log(JSON.stringify({ total: files.length, unowned: unowned.length, paths: unowned }));
  } else {
    if (unowned.length === 0) {
      console.log(`All ${files.length} files have owners.`);
    } else {
      console.log(`${unowned.length}/${files.length} files have no owner:\n`);
      for (const p of unowned) {
        console.log(`  ${p}`);
      }
    }
  }
}

function cmdStats() {
  const { result } = loadRules();
  const dir = targetPath || '.';
  const files = walkDir(dir);
  const matches = matchMany(result.rules, files);
  const s = stats(matches);

  if (jsonOutput) {
    const byOwner = {};
    for (const [owner, count] of s.byOwner) {
      byOwner[owner] = count;
    }
    console.log(JSON.stringify({
      total: s.total,
      owned: s.owned,
      unowned: s.unowned,
      coverage: s.total > 0 ? ((s.owned / s.total) * 100).toFixed(1) + '%' : '0%',
      byOwner,
    }));
  } else {
    const coverage = s.total > 0 ? ((s.owned / s.total) * 100).toFixed(1) : '0.0';
    console.log(`Ownership coverage: ${coverage}% (${s.owned}/${s.total})`);
    console.log(`Unowned: ${s.unowned}\n`);
    console.log('By owner:');
    const sorted = [...s.byOwner.entries()].sort((a, b) => b[1] - a[1]);
    for (const [owner, count] of sorted) {
      const pct = ((count / s.total) * 100).toFixed(1);
      console.log(`  ${owner.padEnd(30)} ${count} files (${pct}%)`);
    }
  }
}

function cmdValidate() {
  const { file, result } = loadRules();

  if (result.errors.length === 0 && result.warnings.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: true, rules: result.rules.length }));
    } else {
      console.log(`✓ ${file} is valid (${result.rules.length} rules)`);
    }
  } else {
    if (jsonOutput) {
      console.log(JSON.stringify({
        valid: result.errors.length === 0,
        errors: result.errors,
        warnings: result.warnings,
        rules: result.rules.length,
      }));
    } else {
      for (const err of result.errors) {
        console.log(`✗ ${err}`);
      }
      for (const warn of result.warnings) {
        console.log(`⚠ ${warn}`);
      }
      if (result.errors.length === 0) {
        console.log(`\n✓ ${file} is valid (${result.rules.length} rules, ${result.warnings.length} warnings)`);
      } else {
        console.log(`\n✗ ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
        process.exit(1);
      }
    }
  }
}

// ─── Run ────────────────────────────────────────────────

switch (command) {
  case 'whoowns': cmdWhoowns(); break;
  case 'check': cmdCheck(); break;
  case 'unowned': cmdUnowned(); break;
  case 'stats': cmdStats(); break;
  case 'validate': cmdValidate(); break;
  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
