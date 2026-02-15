import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR, PROFILES_DIR, ensureDir, createProfile, listProfiles } from '../utils/config.mjs';
import { generateFingerprint, listAvailableRegions, listAvailableOS, GEOIP_REGIONS, OS_OPTIONS } from '../utils/fingerprint.mjs';

const FINGERPRINTS_DIR = path.join(CONFIG_DIR, 'fingerprints');

export async function handleCreateCommand(args) {
  const what = args[1];
  
  if (what === 'fingerprint') {
    await handleCreateFingerprint(args);
    return;
  }
  
  if (what === 'profile') {
    const profileId = args[2];
    if (!profileId) throw new Error('Usage: camo create profile <profileId>');
    createProfile(profileId);
    console.log(`Created profile: ${profileId}`);
    return;
  }
  
  throw new Error('Usage: camo create <profile|fingerprint> [options]');
}

async function handleCreateFingerprint(args) {
  // Parse options
  const osIdx = args.indexOf('--os');
  const regionIdx = args.indexOf('--region');
  const outputIdx = args.indexOf('--output');
  const nameIdx = args.indexOf('--name');
  
  const osKey = osIdx >= 0 ? args[osIdx + 1] : 'mac';
  const regionKey = regionIdx >= 0 ? args[regionIdx + 1] : 'us';
  const output = outputIdx >= 0 ? args[outputIdx + 1] : null;
  const name = nameIdx >= 0 ? args[nameIdx + 1] : null;
  
  // Validate options
  if (!OS_OPTIONS[osKey]) {
    console.error(`Invalid OS: ${osKey}`);
    console.error('Available:', Object.keys(OS_OPTIONS).join(', '));
    process.exit(1);
  }
  
  if (!GEOIP_REGIONS[regionKey]) {
    console.error(`Invalid region: ${regionKey}`);
    console.error('Available:', Object.keys(GEOIP_REGIONS).join(', '));
    process.exit(1);
  }
  
  // Generate fingerprint
  const fingerprint = generateFingerprint({ os: osKey, region: regionKey });
  
  // Add metadata
  fingerprint.name = name || `fingerprint-${osKey}-${regionKey}-${Date.now()}`;
  fingerprint.createdAt = new Date().toISOString();
  fingerprint.id = `fp_${Buffer.from(fingerprint.name).toString('base64').slice(0, 12)}`;
  
  // Save or output
  if (output) {
    fs.writeFileSync(output, JSON.stringify(fingerprint, null, 2));
    console.log(`Fingerprint saved to: ${output}`);
  } else {
    // Save to fingerprints directory
    ensureDir(FINGERPRINTS_DIR);
    const fpPath = path.join(FINGERPRINTS_DIR, `${fingerprint.id}.json`);
    fs.writeFileSync(fpPath, JSON.stringify(fingerprint, null, 2));
    console.log(JSON.stringify({
      ok: true,
      fingerprint,
      path: fpPath,
    }, null, 2));
  }
}

export function listFingerprints() {
  if (!fs.existsSync(FINGERPRINTS_DIR)) return [];
  return fs.readdirSync(FINGERPRINTS_DIR, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.json'))
    .map((f) => {
      try {
        const content = fs.readFileSync(path.join(FINGERPRINTS_DIR, f.name), 'utf8');
        const fp = JSON.parse(content);
        return { id: fp.id, name: fp.name, os: fp.os, country: fp.country };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function getFingerprint(id) {
  const fpPath = path.join(FINGERPRINTS_DIR, `${id}.json`);
  if (!fs.existsSync(fpPath)) return null;
  return JSON.parse(fs.readFileSync(fpPath, 'utf8'));
}
