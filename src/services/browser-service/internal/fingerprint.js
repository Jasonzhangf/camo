/**
 * 浏览器指纹管理器
 * 提供稳定的指纹生成、应用和管理功能
 */
import { randomBytes } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
function resolveFingerprintDir() {
    const envDir = String(process.env.CAMO_PATHS_FINGERPRINTS || '').trim();
    if (envDir)
        return envDir;
    const portableRoot = String(process.env.CAMO_PORTABLE_ROOT || process.env.CAMO_ROOT || '').trim();
    if (portableRoot)
        return join(portableRoot, '.camo', 'fingerprints');
    return join(homedir(), '.camo', 'fingerprints');
}
const PLATFORM_FINGERPRINTS = {
    windows: [
        {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Win32',
            osVersion: '10.0',
        },
        {
            userAgent: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Win32',
            osVersion: '11.0',
        },
    ],
    macos: [
        {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'MacIntel',
            osVersion: '10.15.7',
        },
        {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'MacIntel',
            osVersion: '14.6.1',
        },
    ],
};
export function generateFingerprint(profileId = 'default', options = {}) {
    const { platform = null, seed = null } = options;
    const hash = randomBytes(16).toString('hex');
    let base;
    if (platform === 'windows') {
        base = PLATFORM_FINGERPRINTS.windows[hash.charCodeAt(0) % PLATFORM_FINGERPRINTS.windows.length];
    }
    else if (platform === 'macos') {
        base = PLATFORM_FINGERPRINTS.macos[hash.charCodeAt(0) % PLATFORM_FINGERPRINTS.macos.length];
    }
    else {
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
            width: [1366, 1440, 1536, 1920][hash.charCodeAt(3) % 4],
            height: [768, 900, 864, 1080][hash.charCodeAt(4) % 4],
        },
        timezoneId: 'Asia/Shanghai',
        maxTouchPoints: 0,
        vendor: 'Google Inc.',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce, D3D11)',
        originalPlatform: platform || (base.platform === 'Win32' ? 'windows' : 'macos'),
        // 增加一个随机噪声用于区分 profile
        fingerprintSalt: hash.slice(0, 8),
    };
}
export async function applyFingerprint(context, fingerprint) {
    if (!context || !fingerprint)
        return;
    try {
        // 设置User-Agent
        if (fingerprint.userAgent) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'userAgent', {
                    get: () => '${fingerprint.userAgent}',
                    configurable: true
                });
                Object.defineProperty(navigator, 'platform', {
                    get: () => '${fingerprint.platform}',
                    configurable: true
                });
                Object.defineProperty(navigator, 'osVersion', {
                    get: () => '${fingerprint.osVersion || ''}',
                    configurable: true
                });
            `);
        }
        if (fingerprint.vendor) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'vendor', {
                    get: () => '${fingerprint.vendor}',
                    configurable: true
                });
            `);
        }
        // 设置语言
        if (fingerprint.languages && fingerprint.language) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'language', {
                    get: () => '${fingerprint.language}',
                    configurable: true
                });

                Object.defineProperty(navigator, 'languages', {
                    get: () => ${JSON.stringify(fingerprint.languages)},
                    configurable: true
                });
            `);
        }
        // 设置硬件信息
        if (fingerprint.hardwareConcurrency) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => ${fingerprint.hardwareConcurrency},
                    configurable: true
                });
            `);
        }
        // 设置设备内存
        if (fingerprint.deviceMemory) {
            await context.addInitScript(`
                Object.defineProperty(navigator, 'deviceMemory', {
                    get: () => ${fingerprint.deviceMemory},
                    configurable: true
                });
            `);
        }
        // 设置视口 (Camoufox 已在启动时应用，无需重新设置)
        // if (fingerprint.viewport) {
        //     await context.setViewportSize?.(fingerprint.viewport);
        // }
        // 设置时区
        if (fingerprint.timezoneId) {
            context.timezoneId = fingerprint.timezoneId;
        }
        // 移除webdriver标识
        await context.addInitScript(`
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
            });

            delete navigator.__proto__.webdriver;
        `);
    }
    catch (error) {
        console.warn('Failed to apply some fingerprint properties:', error?.message || error);
    }
}
export async function loadFingerprint(fingerprintPath) {
    try {
        const data = await readFile(fingerprintPath, 'utf8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
export async function saveFingerprint(fingerprintPath, fingerprint) {
    try {
        await mkdir(dirname(fingerprintPath), { recursive: true });
        await writeFile(fingerprintPath, JSON.stringify(fingerprint, null, 2));
        return true;
    }
    catch (error) {
        console.error('Failed to save fingerprint:', error);
        return false;
    }
}
export function getFingerprintPath(profileId) {
    return join(resolveFingerprintDir(), `${profileId}.json`);
}
export async function generateAndSaveFingerprint(profileId, options = {}) {
    const fingerprint = generateFingerprint(profileId, options);
    const path = getFingerprintPath(profileId);
    await saveFingerprint(path, fingerprint);
    return { fingerprint, path };
}
export async function loadOrGenerateFingerprint(profileId, options = {}) {
    const path = getFingerprintPath(profileId);
    let fingerprint = await loadFingerprint(path);
    if (!fingerprint) {
        fingerprint = generateFingerprint(profileId, options);
        await saveFingerprint(path, fingerprint);
    }
    return fingerprint;
}
export const FINGERPRINT_DIR = resolveFingerprintDir();
//# sourceMappingURL=fingerprint.js.map
