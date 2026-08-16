// Fingerprint manager. Module id=services.browser_service.internal.fingerprint.
//
// Generates stable Camoufox fingerprints per profile and applies them
// to the browser context via init scripts.
//
// Hard guards:
//   - All fingerprint data lives under ~/.camo/profiles/<id>/.
//   - Root-layer ~/.camo/fingerprints/ is migrated once by services.profile
//     before launch; this owner only reads/writes the profile-owned path.
//   - Generated locale and timezone stay stable across hosts.

import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolveFingerprintPath, resolveProfileDir } from './storage-paths.mjs';

const PLATFORM_FINGERPRINTS = {
    windows: [
        {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
            platform: 'Win32',
            osVersion: '10.0',
            vendor: '',
        },
        {
            userAgent: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
            platform: 'Win32',
            osVersion: '11.0',
            vendor: '',
        },
    ],
    macos: [
        {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
            platform: 'MacIntel',
            osVersion: '10.15.7',
            vendor: '',
        },
        {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:128.0) Gecko/20100101 Firefox/128.0',
            platform: 'MacIntel',
            osVersion: '14.6.1',
            vendor: '',
        },
    ],
};

export function generateFingerprint(profileId = 'default', options = {}) {
    const { platform = null } = options;
    const hash = randomBytes(16).toString('hex');
    let base;
    if (platform === 'windows') {
        base = PLATFORM_FINGERPRINTS.windows[hash.charCodeAt(0) % PLATFORM_FINGERPRINTS.windows.length];
    } else if (platform === 'macos') {
        base = PLATFORM_FINGERPRINTS.macos[hash.charCodeAt(0) % PLATFORM_FINGERPRINTS.macos.length];
    } else {
        const useWindows = hash.charCodeAt(0) % 2 === 0;
        const pool = useWindows ? PLATFORM_FINGERPRINTS.windows : PLATFORM_FINGERPRINTS.macos;
        base = pool[hash.charCodeAt(1) % pool.length];
    }
    return {
        profileId,
        userAgent: base.userAgent,
        platform: base.platform,
        osVersion: base.osVersion,
        languages: ['zh-CN', 'zh', 'en-US', 'en'],
        language: 'zh-CN',
        hardwareConcurrency: [4, 6, 8, 12, 16][hash.charCodeAt(1) % 5],
        deviceMemory: [4, 8, 16, 32][hash.charCodeAt(2) % 4],
        viewport: {
            width:  [1366, 1440, 1536, 1920][hash.charCodeAt(3) % 4],
            height: [768,   900,  864,  1080][hash.charCodeAt(4) % 4],
        },
        timezoneId: 'Asia/Shanghai',
        maxTouchPoints: 0,
        vendor: base.vendor ?? '',
        renderer: '',
        originalPlatform: platform || (base.platform === 'Win32' ? 'windows' : 'macos'),
        fingerprintSalt: hash.slice(0, 8),
    };
}

export async function applyFingerprint(context, fingerprint) {
    if (!context || !fingerprint) return;
    try {
        if (fingerprint.userAgent) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'userAgent', { get: () => '${fingerprint.userAgent}', configurable: true });
                Object.defineProperty(navigator, 'platform',   { get: () => '${fingerprint.platform}',   configurable: true });
                Object.defineProperty(navigator, 'osVersion',  { get: () => '${fingerprint.osVersion || ''}', configurable: true });
            `);
        }
        if (fingerprint.vendor) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'vendor', { get: () => '${fingerprint.vendor}', configurable: true });
            `);
        }
        if (fingerprint.languages && fingerprint.language) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'language',  { get: () => '${fingerprint.language}', configurable: true });
                Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(fingerprint.languages)}, configurable: true });
            `);
        }
        if (fingerprint.hardwareConcurrency) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${fingerprint.hardwareConcurrency}, configurable: true });
            `);
        }
        if (fingerprint.deviceMemory) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'deviceMemory', { get: () => ${fingerprint.deviceMemory}, configurable: true });
            `);
        }
        if (fingerprint.timezoneId) {
            context.timezoneId = fingerprint.timezoneId;
        }
        await context.addInitScript(`
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
            delete navigator.__proto__.webdriver;
        `);
    } catch (error) {
        console.warn('applyFingerprint: failed to apply some properties:', error?.message || error);
    }
}

export function getFingerprintPath(profileId) {
    return resolveFingerprintPath(profileId);
}

export async function loadOrGenerateFingerprint(profileId, options = {}) {
    const fp = getFingerprintPath(profileId);
    let fingerprint = null;
    try {
        if (existsSync(fp)) {
            fingerprint = JSON.parse(readFileSync(fp, 'utf8'));
            if (!fingerprint || fingerprint.profileId !== profileId) {
                fingerprint = null;
            }
        }
    } catch {}
    if (!fingerprint) {
        fingerprint = generateFingerprint(profileId, options);
        try {
            const dir = resolveProfileDir(profileId);
            mkdirSync(dir, { recursive: true });
            writeFileSync(fp, JSON.stringify(fingerprint, null, 2));
        } catch (err) {
            console.warn('loadOrGenerateFingerprint: failed to save fingerprint:', err?.message || err);
        }
    }
    return fingerprint;
}
