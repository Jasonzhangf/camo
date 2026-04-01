#!/usr/bin/env node
/**
 * QR Code screenshot command - takes a screenshot, detects QR codes, and crops the QR code region.
 *
 * Usage:
 *   camo qr-screenshot [profileId] [--output <dir>] [--full] [--padding <px>]
 *
 * Options:
 *   --output, -o <dir>   Output directory for screenshots (default: ./screenshots)
 *   --full               Capture full page instead of viewport
 *   --padding <px>       Padding around detected QR code in pixels (default: 20)
 *   --profile, -p <id>   Profile to use
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';
import { getDefaultProfile } from '../utils/config.mjs';

const require = createRequire(import.meta.url);
let jsQR;
let pngjs;

function ensureDeps() {
  if (!jsQR) jsQR = require('jsqr');
  if (!pngjs) pngjs = require('pngjs');
}

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

/**
 * Detect QR codes in a PNG buffer.
 * Returns array of { data, location, bounds: { x, y, width, height } }
 */
function detectQRCodes(pngBuffer) {
  ensureDeps();
  const { PNG } = pngjs;
  const parsed = PNG.sync.read(pngBuffer);
  const imageData = new Uint8ClampedArray(parsed.data);
  const code = jsQR(imageData, parsed.width, parsed.height, {
    inversionAttempts: 'attemptBoth',
  });

  if (!code) return [];

  const loc = code.location;
  const minX = Math.min(loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x);
  const maxX = Math.max(loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x);
  const minY = Math.min(loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y);
  const maxY = Math.max(loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y);

  return [{
    data: code.data,
    location: loc,
    bounds: {
      x: Math.floor(minX),
      y: Math.floor(minY),
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY),
    },
  }];
}

/**
 * Crop a PNG buffer to the specified region with optional padding.
 * Returns a new PNG buffer.
 */
function cropPNG(pngBuffer, { x, y, width, height }, padding = 20) {
  ensureDeps();
  const { PNG } = pngjs;
  const src = PNG.sync.read(pngBuffer);

  const pad = Math.max(0, Math.floor(padding));
  const cropX = Math.max(0, x - pad);
  const cropY = Math.max(0, y - pad);
  const cropW = Math.min(src.width - cropX, width + pad * 2);
  const cropH = Math.min(src.height - cropY, height + pad * 2);

  if (cropW <= 0 || cropH <= 0) {
    throw new Error('Crop region is empty');
  }

  const dst = new PNG({ width: cropW, height: cropH });
  for (let row = 0; row < cropH; row++) {
    const srcRow = cropY + row;
    const srcIdx = (srcRow * src.width + cropX) * 4;
    const dstIdx = row * cropW * 4;
    const copyLen = cropW * 4;
    dst.data.set(src.data.subarray(srcIdx, srcIdx + copyLen), dstIdx);
  }

  return PNG.sync.write(dst);
}

export async function handleQRScreenshotCommand(args) {
  await ensureBrowserService();
  ensureDeps();

  const fullPage = args.includes('--full');
  const paddingArg = readFlagValue(args, ['--padding']);
  const padding = Math.max(0, Number(paddingArg) || 20);
  const outputArg = readFlagValue(args, ['--output', '-o']);
  const outputDir = outputArg || path.resolve(process.cwd(), 'screenshots');

  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (['--full', '--padding', '--output', '-o', '--profile', '-p'].includes(arg)) {
      if (['--padding', '--output', '-o', '--profile', '-p'].includes(arg)) i++;
      continue;
    }
    if (arg.startsWith('--')) continue;
    profileId = arg;
    break;
  }
  if (!profileId) profileId = getDefaultProfile();
  if (!profileId) throw new Error('Usage: camo qr-screenshot [profileId] [--output <dir>] [--full] [--padding <px>]');

  // 1. Take screenshot via browser service
  const result = await callAPI('screenshot', { profileId, fullPage });
  if (!result?.data) {
    throw new Error('Screenshot failed: no image data returned');
  }

  const pngBuffer = Buffer.from(result.data, 'base64');
  await fs.promises.mkdir(outputDir, { recursive: true });

  // 2. Save full screenshot
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fullScreenshotPath = path.join(outputDir, `screenshot_${timestamp}.png`);
  await fs.promises.writeFile(fullScreenshotPath, pngBuffer);

  // 3. Detect QR codes
  const qrCodes = detectQRCodes(pngBuffer);

  if (qrCodes.length === 0) {
    console.log(JSON.stringify({
      ok: true,
      qrFound: false,
      message: 'No QR code detected in screenshot',
      screenshotPath: fullScreenshotPath,
    }, null, 2));
    return;
  }

  // 4. Crop each QR code and save
  const croppedResults = [];
  for (let i = 0; i < qrCodes.length; i++) {
    const qr = qrCodes[i];
    const croppedBuffer = cropPNG(pngBuffer, qr.bounds, padding);
    const croppedPath = path.join(outputDir, `qrcode_${timestamp}_${i + 1}.png`);
    await fs.promises.writeFile(croppedPath, croppedBuffer);
    croppedResults.push({
      qrData: qr.data,
      bounds: qr.bounds,
      croppedPath,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    qrFound: true,
    qrCount: qrCodes.length,
    screenshotPath: fullScreenshotPath,
    qrCodes: croppedResults,
  }, null, 2));
}
