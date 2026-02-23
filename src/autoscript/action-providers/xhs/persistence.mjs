import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function sanitizeForPath(name, fallback = 'unknown') {
  const text = String(name || '').trim();
  if (!text) return fallback;
  const cleaned = text.replace(/[\\/:"*?<>|]+/g, '_').trim();
  return cleaned || fallback;
}

function resolveDownloadRoot(customRoot) {
  const fromParams = String(customRoot || '').trim();
  if (fromParams) return path.resolve(fromParams);
  const fromEnv = String(process.env.WEBAUTO_DOWNLOAD_ROOT || process.env.WEBAUTO_DOWNLOAD_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.webauto', 'download');
}

export function resolveXhsOutputContext({
  params = {},
  state = {},
  noteId = null,
} = {}) {
  const keywordRaw = String(params.keyword || state.keyword || 'unknown').trim();
  const envRaw = String(params.env || state.env || 'debug').trim();
  const resolvedNoteId = String(noteId || params.noteId || state.currentNoteId || 'unknown').trim();
  const root = resolveDownloadRoot(params.outputRoot || params.downloadRoot || params.rootDir);
  const keyword = sanitizeForPath(keywordRaw, 'unknown');
  const env = sanitizeForPath(envRaw, 'debug');
  const note = sanitizeForPath(resolvedNoteId, 'unknown');
  const keywordDir = path.join(root, 'xiaohongshu', env, keyword);
  const noteDir = path.join(keywordDir, note);
  return {
    root,
    env,
    keyword,
    noteId: note,
    keywordDir,
    noteDir,
    commentsPath: path.join(noteDir, 'comments.jsonl'),
    likeStatePath: path.join(keywordDir, '.like-state.jsonl'),
    likeEvidenceDir: path.join(keywordDir, 'like-evidence', note),
    virtualLikeEvidenceDir: path.join(keywordDir, 'virtual-like', note),
  };
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonlRows(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function appendJsonlRows(filePath, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  await ensureDir(path.dirname(filePath));
  const payload = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.appendFile(filePath, `${payload}\n`, 'utf8');
}

function normalizeCommentRow(noteId, row) {
  return {
    noteId: String(noteId || ''),
    userName: String(row?.userName || row?.author || row?.user_name || '').trim(),
    userId: String(row?.userId || row?.user_id || '').trim(),
    content: String(row?.content || row?.text || '').replace(/\s+/g, ' ').trim(),
    time: String(row?.time || row?.timestamp || '').trim(),
    likeCount: Number(row?.likeCount || row?.like_count || 0),
    ts: new Date().toISOString(),
  };
}

function commentDedupKey(row) {
  return `${String(row?.userId || '')}:${String(row?.content || '')}`;
}

export async function mergeCommentsJsonl({ filePath, noteId, comments = [] }) {
  const existing = await readJsonlRows(filePath);
  const seen = new Set(
    existing
      .map((row) => commentDedupKey(row))
      .filter((key) => key && !key.endsWith(':')),
  );

  const added = [];
  for (const row of comments) {
    const normalized = normalizeCommentRow(noteId, row);
    if (!normalized.content) continue;
    const key = commentDedupKey(normalized);
    if (!key || key.endsWith(':')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(normalized);
  }

  await appendJsonlRows(filePath, added);
  return {
    filePath,
    added: added.length,
    existing: existing.length,
    total: existing.length + added.length,
    rowsAdded: added,
  };
}

export function makeLikeSignature({ noteId, userId = '', userName = '', text = '' }) {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return [
    String(noteId || '').trim(),
    String(userId || '').trim(),
    String(userName || '').trim(),
    normalizedText,
  ].join('|');
}

export async function loadLikedSignatures(filePath) {
  const rows = await readJsonlRows(filePath);
  const out = new Set();
  for (const row of rows) {
    const signature = String(row?.signature || '').trim();
    if (signature) out.add(signature);
  }
  return out;
}

export async function appendLikedSignature(filePath, signature, extra = {}) {
  const value = String(signature || '').trim();
  if (!value) return;
  await appendJsonlRows(filePath, [{
    ts: new Date().toISOString(),
    signature: value,
    ...extra,
  }]);
}

export async function savePngBase64(filePath, base64Data) {
  const payload = String(base64Data || '').trim();
  if (!payload) return null;
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, Buffer.from(payload, 'base64'));
  return filePath;
}

export async function writeJsonFile(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}
