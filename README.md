# @sulthonzh/codeowners

Zero-dependency GitHub CODEOWNERS parser, validator, and path matcher for Node.js.

## Why

CODEOWNERS files are how GitHub decides who reviews what. But there's no official parser library — you're either copy-pasting regex from Stack Overflow or pulling in a heavy dependency. This is a clean, tested, zero-dep solution that handles the full CODEOWNERS syntax.

## Install

```bash
npm install @sulthonzh/codeowners
```

## Usage

### Library

```js
const { parse, getOwners, matchOwner, findUnowned, stats } = require('@sulthonzh/codeowners');

const content = `
# Default
*                    @octocat

# Frontend
/src/web/            @frontend/team @alice
*.css                @frontend/team

# Backend
/src/api/            @backend/team
`;

const { rules } = parse(content);

// Who owns a file?
getOwners(rules, 'src/web/app.js');    // ['@frontend/team', '@alice']
getOwners(rules, 'src/web/style.css'); // ['@frontend/team'] (last match wins)
getOwners(rules, 'README.md');         // ['@octocat']

// Check if a path has owners
const rule = matchOwner(rules, 'docs/guide.md');
if (!rule) console.log('Unowned file!');

// Find all unowned files
const unowned = findUnowned(rules, ['src/api/index.js', 'logo.png']);
// → ['logo.png']

// Ownership stats
const s = stats([
  { owners: ['@alice'] },
  { owners: ['@alice', '@bob'] },
  { owners: [] },
]);
// { total: 3, owned: 2, unowned: 1, byOwner: Map { '@alice' => 2, '@bob' => 1 } }
```

### CLI

```bash
# Who owns a file?
codeowners whoowns src/index.js

# Check if a file has owners (exits 1 if not)
codeowners check src/index.js

# Find unowned files in a directory
codeowners unowned .

# Show ownership coverage stats
codeowners stats

# Validate syntax
codeowners validate

# JSON output
codeowners stats --json
codeowners whoowns src/index.js --json
```

## Pattern Matching Rules

| Pattern | Matches | Notes |
|---------|---------|-------|
| `*` | Everything | Catch-all |
| `*.md` | All `.md` files anywhere | No `/` → any depth |
| `/*.md` | `.md` files in root only | `/` anchors to root |
| `/src/` | `src/` dir + everything under it | Trailing `/` = directory |
| `src/` | Same as `/src/` | Leading `/` optional for paths |
| `/docs/**` | Everything under `docs/` | `**` crosses `/` |
| `**/config.json` | `config.json` at any depth | `**/` at start |
| `/src/**/*.test.js` | Test files under `src/` | `**` in middle |
| `Makefile` | Any `Makefile` at any depth | No `/` → any depth |

**Last match wins.** If multiple patterns match a path, the last one in the file takes precedence.

## Owner Formats

| Format | Type | Example |
|--------|------|---------|
| `@username` | GitHub user | `@octocat` |
| `@org/team` | GitHub team | `@github/owners` |
| `user@example.com` | Email | `dev@company.com` |
| `^@username` | Optional owner (Enterprise) | `^@reviewer` |

## API

### `parse(content)` → `{ rules, errors, warnings }`

Parse CODEOWNERS file content.

### `parseFile(path)` → `{ rules, errors, warnings }`

Parse from a file path.

### `matchOwner(rules, path)` → `Rule | null`

Find the owning rule for a path (last match wins).

### `getOwners(rules, path)` → `string[]`

Get owner list for a path.

### `matchMany(rules, paths)` → `Array<{ path, owners, rule }>`

Batch match multiple paths.

### `findUnowned(rules, paths)` → `string[]`

Filter paths that have no owner.

### `stats(matches)` → `{ total, owned, unowned, byOwner }`

Compute ownership statistics.

### `validateOwner(owner)` → `{ valid, type, error? }`

Validate a single owner string.

## License

MIT
