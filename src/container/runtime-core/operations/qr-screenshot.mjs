/**
 * QR code screenshot operation for runtime-core.
 *
 * Takes a screenshot, detects QR codes in the image,
 * and returns the QR data along with cropped QR code image paths.
 *
 * Action: screenshot_qr
 * Params:
 *   - outputDir: directory to save screenshots (default: ./screenshots)
 *   - fullPage: boolean, capture full page (default: false)
 *   - padding: pixel padding around QR code (default: 20)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { callAPI } from '../../../utils/browser-service.mjs';

const require = createRequire(import.meta.url);
let jsQR;
let pngjs;

function ensureDeps() {
  if (!jsQR) jsQR = require('jsqr');
  if (!pngjs) pngjs = require('pngjs');
}

/**
 * Detect QR codes in a PNG buffer.
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

/**
 * Execute screenshot_qr operation.
 * Called by executeOperation when action === 'screenshot_qr'.
 */
export async function executeQRScreenshotOperation({ profileId, params = {} }) {
  ensureDeps();

  const fullPage = params.fullPage === true;
  const padding = Math.max(0, Number(params.padding) || 20);
  const outputDir = String(params.outputDir || '').trim() || path.resolve(process.cwd(), 'screenshots');

  // 1. Take screenshot
  const result = await callAPI('screenshot', { profileId, fullPage });
  if (!result?.data) {
    return {
      ok: false,
      code: 'SCREENSHOT_FAILED',
      message: 'Screenshot failed: no image data returned from browser service',
    };
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
    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'screenshot_qr done: no QR code detected',
      data: {
        qrFound: false,
        qrCount: 0,
        screenshotPath: fullScreenshotPath,
        qrCodes: [],
      },
    };
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

  return {
    ok: true,
    code: 'OPERATION_DONE',
    message: `screenshot_qr done: ${qrCodes.length} QR code(s) detected`,
    data: {
      qrFound: true,
      qrCount: qrCodes.length,
      screenshotPath: fullScreenshotPath,
      qrCodes: croppedResults,
    },
  };
}
