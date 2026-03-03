#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function getSqlFormatter() {
  // Works whether sql-formatter is ESM-only or CJS, across Node 18–22+
  const mod = await import('sql-formatter');
  return mod.format || (mod.default && mod.default.format);
}

function formatFile(filePath, checkOnly, format) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const formatted = format(raw, {
    language: 'postgresql',
    uppercase: false,
    linesBetweenQueries: 2,
  });

  if (checkOnly) {
    if (raw !== formatted) {
      console.error(`File not formatted: ${filePath}`);
      return 1;
    }
    return 0;
  }

  fs.writeFileSync(filePath, formatted, 'utf8');
  console.log(`Formatted ${filePath}`);
  return 0;
}

function walkDir(dir, ext) {
  const results = [];
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      results.push(...walkDir(p, ext));
    } else if (p.endsWith(ext)) {
      results.push(p);
    }
  });
  return results;
}

(async () => {
  const format = await getSqlFormatter();
  if (typeof format !== 'function') {
    console.error(
      "Could not load sql-formatter's format() function. Check installed sql-formatter version.",
    );
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const sqlDirs = [path.join(repoRoot, 'supabase'), path.join(repoRoot, 'supabase', 'migrations')];

  let exitCode = 0;
  const checkOnly = process.argv.includes('--check');

  for (const d of sqlDirs) {
    if (!fs.existsSync(d)) continue;
    const files = walkDir(d, '.sql');
    for (const f of files) {
      const rc = formatFile(f, checkOnly, format);
      if (rc !== 0) exitCode = rc;
    }
  }

  process.exit(exitCode);
})();
