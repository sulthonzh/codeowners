'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parse, matchOwner, getOwners, matchMany,
  findUnowned, stats, validateOwner, patternToRegex,
} = require('../src/index');

// ─── Pattern Compilation ────────────────────────────────

test('filename pattern matches at any depth', () => {
  const re = patternToRegex('README.md');
  assert.ok(re.test('README.md'));
  assert.ok(re.test('src/README.md'));
  assert.ok(!re.test('README.txt'));
});

test('leading slash anchors to root', () => {
  const re = patternToRegex('/README.md');
  assert.ok(re.test('README.md'));
  assert.ok(!re.test('src/README.md'));
});

test('directory pattern anchored to root', () => {
  const re = patternToRegex('src/');
  assert.ok(re.test('src'));
  assert.ok(re.test('src/index.js'));
  assert.ok(re.test('src/deep/nested/file.js'));
  assert.ok(!re.test('public/src/index.js'));
});

test('leading slash directory', () => {
  const re = patternToRegex('/docs/');
  assert.ok(re.test('docs'));
  assert.ok(re.test('docs/guide.md'));
  assert.ok(!re.test('src/docs/guide.md'));
});

test('wildcard * matches within one segment', () => {
  const re = patternToRegex('*.md');
  assert.ok(re.test('README.md'));
  assert.ok(re.test('GUIDE.md'));
  // No slash in pattern → matches at any depth
  assert.ok(re.test('docs/guide.md'));
  assert.ok(!re.test('guide.txt'));
});

test('anchored wildcard stays in root', () => {
  const re = patternToRegex('/*.md');
  assert.ok(re.test('README.md'));
  assert.ok(!re.test('docs/guide.md'));
});

test('double wildcard ** at end', () => {
  const re = patternToRegex('/docs/**');
  assert.ok(re.test('docs/anything'));
  assert.ok(re.test('docs/deep/nested/file'));
});

test('** in middle crosses segments', () => {
  const re = patternToRegex('/src/**/test');
  assert.ok(re.test('src/foo/test'));
  assert.ok(re.test('src/foo/bar/test'));
});

test('**/ at start matches any depth', () => {
  const re = patternToRegex('**/config.json');
  assert.ok(re.test('config.json'));
  assert.ok(re.test('src/config.json'));
  assert.ok(re.test('deep/nested/path/config.json'));
});

test('/**/ in middle with suffix', () => {
  const re = patternToRegex('/src/**/fixtures/*.json');
  assert.ok(re.test('src/a/fixtures/data.json'));
  assert.ok(re.test('src/a/b/fixtures/data.json'));
  assert.ok(!re.test('src/fixtures/sub/data.json'));
});

test('? matches single char', () => {
  const re = patternToRegex('/file?.txt');
  assert.ok(re.test('file1.txt'));
  assert.ok(re.test('fileA.txt'));
  assert.ok(!re.test('file12.txt'));
});

test('dot in pattern is literal', () => {
  const re = patternToRegex('/config.json');
  assert.ok(re.test('config.json'));
  assert.ok(!re.test('configxjson'));
});

// ─── Owner Validation ───────────────────────────────────

test('valid username', () => {
  assert.strictEqual(validateOwner('@octocat').valid, true);
  assert.strictEqual(validateOwner('@octocat').type, 'user');
});

test('valid team', () => {
  assert.strictEqual(validateOwner('@github/owners').valid, true);
  assert.strictEqual(validateOwner('@github/owners').type, 'team');
});

test('valid email', () => {
  assert.strictEqual(validateOwner('dev@example.com').valid, true);
});

test('optional owner', () => {
  assert.strictEqual(validateOwner('^@octocat').valid, true);
});

test('invalid - bare name', () => {
  assert.strictEqual(validateOwner('octocat').valid, false);
});

test('invalid - starts with number', () => {
  assert.strictEqual(validateOwner('@1user').valid, false);
});

test('invalid - too long', () => {
  assert.strictEqual(validateOwner('@' + 'a'.repeat(40)).valid, false);
});

test('valid org with hyphens', () => {
  assert.strictEqual(validateOwner('@my-org/team-name').valid, true);
});

// ─── Parsing ────────────────────────────────────────────

test('parse basic rules', () => {
  const result = parse('# Default\n* @octocat\n\n/docs/ @github/docs-team\n*.md @writer\n');
  assert.strictEqual(result.rules.length, 3);
  assert.strictEqual(result.rules[0].pattern, '*');
  assert.deepStrictEqual(result.rules[0].owners, ['@octocat']);
  assert.strictEqual(result.rules[1].pattern, '/docs/');
});

test('parse skips empty lines and comments', () => {
  assert.strictEqual(parse('# comment\n\n   \n').rules.length, 0);
});

test('parse warns on no owners', () => {
  const result = parse('*.js\n');
  assert.strictEqual(result.warnings.length, 1);
});

test('parse multiple owners', () => {
  const result = parse('/src/ @alice @bob @org/team dev@test.com\n');
  assert.strictEqual(result.rules[0].owners.length, 4);
});

test('parse strips trailing comments', () => {
  const result = parse('/src/ @alice # important code\n');
  assert.deepStrictEqual(result.rules[0].owners, ['@alice']);
});

test('parse tracks line numbers', () => {
  const result = parse('# comment\n\n/src/ @alice\n*.js @bob\n');
  assert.strictEqual(result.rules[0].line, 3);
  assert.strictEqual(result.rules[1].line, 4);
});

test('parse skips section headers', () => {
  const result = parse('^Default\n* @alice\n^Frontend\n*.css @bob\n');
  assert.strictEqual(result.rules.length, 2);
});

// ─── Matching ───────────────────────────────────────────

test('last match wins', () => {
  const { rules } = parse('* @default\n/src/ @src-team\n/src/test/ @qa-team\n');
  assert.strictEqual(matchOwner(rules, 'src/test/spec.js').owners[0], '@qa-team');
  assert.strictEqual(matchOwner(rules, 'src/index.js').owners[0], '@src-team');
  assert.strictEqual(matchOwner(rules, 'README.md').owners[0], '@default');
});

test('no match returns null', () => {
  const { rules } = parse('/src/ @alice\n');
  assert.strictEqual(matchOwner(rules, 'docs/index.md'), null);
});

test('getOwners returns array', () => {
  const { rules } = parse('/src/ @alice @bob\n');
  assert.deepStrictEqual(getOwners(rules, 'src/index.js'), ['@alice', '@bob']);
});

test('getOwners empty for no match', () => {
  const { rules } = parse('/src/ @alice\n');
  assert.deepStrictEqual(getOwners(rules, 'docs/readme.md'), []);
});

test('matchMany batch', () => {
  const { rules } = parse('* @alice\n/src/ @bob\n');
  const results = matchMany(rules, ['README.md', 'src/index.js', 'docs/guide.md']);
  assert.deepStrictEqual(results[0].owners, ['@alice']);
  assert.deepStrictEqual(results[1].owners, ['@bob']);
  assert.deepStrictEqual(results[2].owners, ['@alice']);
});

test('findUnowned', () => {
  const { rules } = parse('/src/ @alice\n');
  assert.deepStrictEqual(findUnowned(rules, ['src/index.js', 'docs/readme.md']), ['docs/readme.md']);
});

// ─── Stats ──────────────────────────────────────────────

test('stats basic', () => {
  const { rules } = parse('* @alice\n/src/ @bob @alice\n');
  const s = stats(matchMany(rules, ['README.md', 'src/index.js', 'docs/guide.md']));
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.byOwner.get('@alice'), 3);
  assert.strictEqual(s.byOwner.get('@bob'), 1);
});

test('stats counts unowned', () => {
  const { rules } = parse('/src/ @alice\n');
  const s = stats(matchMany(rules, ['src/a.js', 'docs/b.md']));
  assert.strictEqual(s.owned, 1);
  assert.strictEqual(s.unowned, 1);
});

// ─── Real World ─────────────────────────────────────────

test('typical CODEOWNERS file', () => {
  const content = [
    '*           @octocat',
    '/src/web/   @frontend/team @alice',
    '*.css       @frontend/team',
    '/src/api/   @backend/team',
    '/docs/      @docs-team',
    '*.md        @docs-team',
    '/.github/   @devops',
  ].join('\n');

  const result = parse(content);
  assert.strictEqual(result.errors.length, 0);

  // CSS in web — *.css (line 3) is after /src/web/ (line 2) → last wins
  assert.deepStrictEqual(getOwners(result.rules, 'src/web/style.css'), ['@frontend/team']);

  // MD in docs — *.md (line 6) is after /docs/ (line 5) → last wins
  assert.deepStrictEqual(getOwners(result.rules, 'docs/guide.md'), ['@docs-team']);

  // Web JS — only /src/web/ matches (besides *)
  assert.deepStrictEqual(getOwners(result.rules, 'src/web/app.js'), ['@frontend/team', '@alice']);

  // GitHub workflow
  assert.deepStrictEqual(getOwners(result.rules, '.github/workflows/ci.yml'), ['@devops']);

  // Root file
  assert.deepStrictEqual(getOwners(result.rules, 'package.json'), ['@octocat']);
});

test('glob ** patterns', () => {
  const content = '/src/**/*.test.js  @qa\n/docs/**/*.md  @docs\n';
  const result = parse(content);
  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual(getOwners(result.rules, 'src/unit/foo.test.js'), ['@qa']);
  assert.deepStrictEqual(getOwners(result.rules, 'src/deep/nested/bar.test.js'), ['@qa']);
  assert.deepStrictEqual(getOwners(result.rules, 'docs/api/v2-guide.md'), ['@docs']);
  assert.deepStrictEqual(getOwners(result.rules, 'src/index.js'), []);
});

test('star matches everything', () => {
  const { rules } = parse('* @everyone\n');
  assert.deepStrictEqual(getOwners(rules, 'any/file.go'), ['@everyone']);
  assert.deepStrictEqual(getOwners(rules, 'root.txt'), ['@everyone']);
});

test('CRLF handling', () => {
  const result = parse('* @alice\r\n/src/ @bob\r\n');
  assert.strictEqual(result.rules.length, 2);
  assert.strictEqual(result.rules[0].pattern, '*');
  assert.strictEqual(result.rules[1].pattern, '/src/');
});
