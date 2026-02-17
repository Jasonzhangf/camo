#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'src');
const MAX_LINES = Number(process.env.FILE_MAX_LINES || 500);
const POLICY_FILE = path.join(ROOT, 'scripts', 'file-size-policy.json');
const EXTS = new Set(['.mjs', '.js', '.ts', '.tsx']);

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...await walk(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTS.has(ext)) continue;
    out.push(fullPath);
  }
  return out;
}

function countLines(content) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function relative(p) {
  return path.relative(ROOT, p).replaceAll(path.sep, '/');
}

async function main() {
  let policy = { defaultMaxLines: MAX_LINES, overrides: {} };
  try {
    const raw = await fs.readFile(POLICY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    policy = {
      defaultMaxLines: Number(parsed?.defaultMaxLines || MAX_LINES),
      overrides: parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
    };
  } catch {}

  const files = await walk(TARGET_DIR);
  const violations = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const lines = countLines(text);
    const rel = relative(file);
    const overrideLimit = Number(policy.overrides?.[rel]);
    const limit = Number.isFinite(overrideLimit) && overrideLimit > 0
      ? overrideLimit
      : policy.defaultMaxLines;
    if (lines > limit) {
      violations.push({ file: rel, lines, limit });
    }
  }

  if (violations.length === 0) {
    console.log(`file-size-check: OK (${files.length} files, default max ${policy.defaultMaxLines} lines)`);
    return;
  }

  console.error(`file-size-check: ${violations.length} file(s) exceed configured limits`);
  for (const item of violations) {
    console.error(` - ${item.file}: ${item.lines} > ${item.limit}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`file-size-check: failed - ${err?.message || err}`);
  process.exit(1);
});
