import fs from 'fs';
import path from 'path';

/**
 * Guard: a `module.exports = { ... }` object literal replaces the module's exports
 * wholesale, so any TypeScript `export` that is not listed there is `undefined` for a
 * CommonJS consumer — including a TypeScript sibling that tsx compiles to `require`.
 *
 * The 2026-09-26 outage this file exists to prevent:
 *   `services/xtream-service.ts` grew a `verifySampleLimit` named export while the
 *   trailing `module.exports = { … }` list kept its old members. `task-registry.ts`
 *   then called `verifySampleLimit()` and got
 *   `(0 , import_xtream_service.verifySampleLimit) is not a function` — every scheduled
 *   Xtream sync died in 0 ms, surfaced only as "failed in 0.0s", and the two sources sat
 *   stale behind an alert that pointed at the provider instead of at this list.
 *
 * This test is static on purpose: it needs no database, no import of the modules under
 * test, and it reports the exact missing names so the fix is obvious.
 */

const SRC = path.resolve(__dirname, '..');

/** Value exports that survive to runtime. Types/interfaces are erased, so they are not included. */
function tsValueExports(source: string): Set<string> {
  const names = new Set<string>();

  for (const m of source.matchAll(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // `export const a = 1, b = 2;` — split on top-level commas only.
  for (const m of source.matchAll(/^\s*export\s+(?:const|let|var)\s+([^=;\n]+)/gm)) {
    let depth = 0;
    let current = '';
    const parts: string[] = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
    for (const part of parts) {
      const name = part.trim().split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // `export { a, b as c };`
  for (const m of source.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const name = part.includes(' as ') ? part.split(' as ').pop()!.trim() : part;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return names;
}

/** Keys of a top-level `module.exports = { ... };` object literal. */
function cjsExportKeys(source: string): Set<string> | null {
  const block = source.match(/^module\.exports\s*=\s*\{([\s\S]*?)\n\};/m);
  if (!block) return null;
  const keys = new Set<string>();
  for (const line of block[1].split('\n')) {
    const cleaned = line.split('//')[0].trim().replace(/,$/, '');
    if (!cleaned) continue;
    const m = cleaned.match(/^([A-Za-z_$][\w$]*)\s*(?::|,)?/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('CommonJS export parity', () => {
  it('never lets a module.exports literal drop a TypeScript value export', () => {
    const violations: string[] = [];

    for (const file of walk(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('module.exports')) continue;
      const declared = tsValueExports(source);
      const cjs = cjsExportKeys(source);
      if (cjs === null) continue; // `module.exports = someOtherModule` — not a literal to audit
      const missing = [...declared].filter((name) => !cjs.has(name) && name !== 'default').sort();
      if (missing.length > 0) {
        violations.push(`${path.relative(SRC, file)}: ${missing.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('exposes the Xtream sync helpers to CommonJS consumers', () => {
    // The runtime shape, not just the source text: this is what `task-registry.ts` sees.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const xt = require('../services/xtream-service');
    expect(typeof xt.verifySampleLimit).toBe('function');
    expect(typeof xt.syncXtreamSource).toBe('function');
    expect(xt.DEFAULT_VERIFY_SAMPLE_LIMIT).toBe(6);
    expect(xt.verifySampleLimit()).toBe(6);
  });
});
