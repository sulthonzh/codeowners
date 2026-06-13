'use strict';

/**
 * @sulthonzh/codeowners
 * Zero-dep GitHub CODEOWNERS parser, validator, and path matcher.
 *
 * Pattern matching follows gitignore/CODEOWNERS conventions:
 *   - Patterns without / match at any depth (e.g. *.md matches docs/guide.md)
 *   - Patterns with / are anchored to root
 *   - Leading / is explicit root anchor (optional)
 *   - Trailing / means directory match (dir + everything under it)
 *   - * matches within a single path segment (not /)
 *   - ** matches across path segments (including /)
 *   - ? matches single char except /
 *   - Last matching rule wins
 */

function patternToRegex(pattern) {
  let p = pattern;
  const isDir = p.endsWith('/');
  const hadLeadingSlash = p.startsWith('/');

  if (hadLeadingSlash) p = p.slice(1);
  if (isDir) p = p.slice(0, -1);

  // Pattern is anchored if it originally contained any slash
  const anchored = hadLeadingSlash || isDir || p.includes('/');

  let re = '';

  for (let i = 0; i < p.length; i++) {
    const c = p[i];

    // Handle ** (double wildcard)
    if (c === '*' && p[i + 1] === '*') {
      const prevSlash = i > 0 && p[i - 1] === '/';
      const atEnd = i + 2 >= p.length;
      const nextSlash = !atEnd && p[i + 2] === '/';

      if (prevSlash && atEnd) {
        // /** at end — the / is already in re; replace it
        re = re.slice(0, -1);
        re += '(?:/.*)?';
        i += 1;
        continue;
      } else if (prevSlash && nextSlash) {
        // /**/ in middle — remove trailing / from re, add cross-segment pattern
        re = re.slice(0, -1);
        re += '(?:/.*)?/';
        i += 2;
        continue;
      } else if (i === 0 && nextSlash) {
        // **/ at start
        re += '(?:.*/)?';
        i += 2;
        continue;
      } else {
        // ** standalone
        re += '.*';
        i += 1;
        continue;
      }
    }

    if (c === '*') { re += '[^/]*'; continue; }
    if (c === '?') { re += '[^/]'; continue; }
    if ('.+^${}()|[]\\'.includes(c)) { re += '\\' + c; continue; }
    re += c;
  }

  // Assemble final regex
  if (isDir) {
    if (anchored) {
      return new RegExp('^' + re + '(?:/.*)?$');
    }
    return new RegExp('^(?:.*/)?' + re + '(?:/.*)?$');
  }
  if (anchored) {
    return new RegExp('^' + re + '$');
  }
  return new RegExp('^(?:.*/)?' + re + '$');
}

// ─── Owner Validation ───────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^@[a-zA-Z][a-zA-Z0-9-]{0,38}$/;
const TEAM_RE = /^@[a-zA-Z][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_-]+$/;

function validateOwner(owner) {
  if (owner.startsWith('^')) {
    const r = validateOwner(owner.slice(1));
    if (!r.valid) return { valid: false, type: 'invalid', error: 'Invalid optional owner: ' + owner };
    return { valid: true, type: 'optional-' + r.type };
  }
  if (TEAM_RE.test(owner)) return { valid: true, type: 'team' };
  if (USERNAME_RE.test(owner)) return { valid: true, type: 'user' };
  if (EMAIL_RE.test(owner)) return { valid: true, type: 'email' };
  return { valid: false, type: 'invalid', error: 'Invalid owner format: ' + owner };
}

// ─── Parser ─────────────────────────────────────────────

function parse(content) {
  const lines = content.split('\n');
  const rules = [];
  const errors = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];

    // Strip comments
    const hashIdx = raw.indexOf('#');
    const line = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const trimmed = line.trim();

    if (trimmed === '') continue;

    // Skip section headers (lines starting with ^)
    if (trimmed.startsWith('^')) continue;

    const parts = trimmed.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter(o => o.length > 0);

    if (!pattern || !/^[/*\w.@-]/.test(pattern)) {
      errors.push('Line ' + lineNum + ': Invalid pattern "' + (pattern || '') + '"');
      continue;
    }

    if (owners.length === 0) {
      warnings.push('Line ' + lineNum + ': Pattern "' + pattern + '" has no owners');
    }

    for (const owner of owners) {
      const result = validateOwner(owner);
      if (!result.valid) errors.push('Line ' + lineNum + ': ' + result.error);
    }

    let regex;
    try {
      regex = patternToRegex(pattern);
    } catch (e) {
      errors.push('Line ' + lineNum + ': Failed to compile pattern "' + pattern + '": ' + e.message);
      continue;
    }

    rules.push({ pattern, owners, line: lineNum, regex });
  }

  return { rules, errors, warnings };
}

function parseFile(filePath) {
  const fs = require('fs');
  return parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Matching ───────────────────────────────────────────

function matchOwner(rules, path) {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  let matched = null;
  for (const rule of rules) {
    if (rule.regex.test(normalized)) matched = rule;
  }
  return matched;
}

function getOwners(rules, path) {
  const rule = matchOwner(rules, path);
  return rule ? rule.owners : [];
}

function matchMany(rules, paths) {
  return paths.map(p => ({ path: p, owners: getOwners(rules, p), rule: matchOwner(rules, p) }));
}

function findUnowned(rules, paths) {
  return paths.filter(p => matchOwner(rules, p) === null);
}

// ─── Stats ──────────────────────────────────────────────

function stats(matches) {
  const total = matches.length;
  let owned = 0, unowned = 0;
  const byOwner = new Map();
  for (const m of matches) {
    if (m.owners.length === 0) { unowned++; continue; }
    owned++;
    for (const o of m.owners) byOwner.set(o, (byOwner.get(o) || 0) + 1);
  }
  return { total, owned, unowned, byOwner };
}

module.exports = { parse, parseFile, matchOwner, getOwners, matchMany, findUnowned, stats, validateOwner, patternToRegex };
