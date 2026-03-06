import fs from 'node:fs';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

export function buildContainerPath(baseDir, containerId) {
  if (!baseDir || !containerId) return null;
  const parts = containerId.split('.').filter(Boolean);
  if (!parts.length) return null;
  return path.join(baseDir, ...parts, 'container.json');
}

export async function readUserContainerDefinition({ rootDir, siteKey, containerId, errorHandler }) {
  if (!rootDir || !siteKey || !containerId) return null;
  const userBase = path.join(rootDir, siteKey);
  const userFile = buildContainerPath(userBase, containerId);
  if (!userFile || !fs.existsSync(userFile)) return null;
  try {
    const raw = await fsPromises.readFile(userFile, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (errorHandler?.debug) {
      errorHandler.debug('controller', 'read container file failed', { error: err?.message || String(err) });
    }
    return null;
  }
}

export async function writeUserContainerDefinition({ rootDir, siteKey, containerId, definition }) {
  if (!rootDir || !siteKey || !containerId) return;
  const parts = containerId.split('.').filter(Boolean);
  const targetDir = path.join(rootDir, siteKey, ...parts);
  await fsPromises.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, 'container.json');
  const payload = { ...definition, id: containerId };
  await fsPromises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}
