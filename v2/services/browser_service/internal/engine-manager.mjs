// Engine manager. Module id=services.browser_service.internal.engine_manager.
//
// Single owner for browser engine lifecycle (Camoufox-only, Chromium removed).
// All browser launches go through launchEngineContext().
//
// Hard guards:
//   - Only Camoufox (Firefox) is supported.
//   - Viewport/screen values must be integer; float causes Firefox crash.
//   - No fallback; Camoufox unavailable = fatal error.

import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

function readNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function getDisplayMetrics() {
    const envWidth  = readNumber(process.env.CAMO_SCREEN_WIDTH  || process.env.CAMO_SCREEN_WIDTH);
    const envHeight = readNumber(process.env.CAMO_SCREEN_HEIGHT || process.env.CAMO_SCREEN_HEIGHT);
    if (envWidth && envHeight) {
        return { width: envWidth, height: envHeight, source: 'env' };
    }
    if (os.platform() === 'darwin') {
        try {
            const sp = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' });
            const spJson = sp.status === 0 && sp.stdout ? JSON.parse(sp.stdout) : null;
            let width = null, height = null;
            const displays = spJson?.SPDisplaysDataType;
            if (Array.isArray(displays) && displays.length > 0) {
                const first = displays[0];
                const gpus = first?._items;
                const maybe = Array.isArray(gpus) && gpus.length > 0 ? gpus[0] : first;
                const resStr = maybe?.spdisplays_ndrvs?.[0]?._spdisplays_resolution
                    || maybe?._spdisplays_resolution;
                if (typeof resStr === 'string') {
                    const m = resStr.match(/(\d+)\s*x\s*(\d+)/i);
                    if (m) { width = readNumber(m[1]); height = readNumber(m[2]); }
                }
            }
            const osascript = spawnSync('osascript', ['-l', 'JavaScript', '-e',
                `ObjC.import('AppKit');
                 const s = $.NSScreen.mainScreen;
                 const f = s.frame;
                 const v = s.visibleFrame;
                 JSON.stringify({
                   width: Number(f.size.width),
                   height: Number(f.size.height),
                   workWidth: Number(v.size.width),
                   workHeight: Number(v.size.height)
                 });`
            ], { encoding: 'utf8' });
            const vf = osascript.status === 0 && osascript.stdout ? JSON.parse(osascript.stdout.trim()) : null;
            const finalW = readNumber(vf?.width) || width;
            const finalH = readNumber(vf?.height) || height;
            const workWidth  = readNumber(vf?.workWidth);
            const workHeight = readNumber(vf?.workHeight);
            if (!finalW || !finalH) return null;
            return {
                width: finalW, height: finalH,
                ...(workWidth  ? { workWidth  } : {}),
                ...(workHeight ? { workHeight } : {}),
                source: 'darwin',
            };
        } catch { return null; }
    }
    if (os.platform() !== 'win32') return null;
    try {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$screen=[System.Windows.Forms.Screen]::PrimaryScreen;',
            '$b=$screen.Bounds;$w=$screen.WorkingArea;',
            '$video=Get-CimInstance Win32_VideoController | Select-Object -First 1;',
            '$nw=$null;$nh=$null;',
            'if($video){$nw=$video.CurrentHorizontalResolution;$nh=$video.CurrentVerticalResolution}',
            '$o=[pscustomobject]@{width=$b.Width;height=$b.Height;workWidth=$w.Width;workHeight=$w.Height;nativeWidth=$nw;nativeHeight=$nh};',
            '$o | ConvertTo-Json -Compress',
        ].join(' ');
        const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8', windowsHide: true,
        });
        if (res.status !== 0 || !res.stdout) return null;
        const payload = JSON.parse(res.stdout.trim());
        const nativeWidth  = readNumber(payload?.nativeWidth);
        const nativeHeight = readNumber(payload?.nativeHeight);
        const width  = readNumber(payload?.width)  || nativeWidth  || null;
        const height = readNumber(payload?.height) || nativeHeight || null;
        const workWidth  = readNumber(payload?.workWidth);
        const workHeight = readNumber(payload?.workHeight);
        if (!width || !height) return null;
        return {
            width, height,
            ...(workWidth  ? { workWidth  } : {}),
            ...(workHeight ? { workHeight } : {}),
            ...(nativeWidth  ? { nativeWidth  } : {}),
            ...(nativeHeight ? { nativeHeight } : {}),
            source: 'win32',
        };
    } catch { return null; }
}

function getDisplayMetricsWithDPR() {
    const dm = getDisplayMetrics();
    const base = dm ? { ...dm } : {};
    const width  = Number(base.width)  || 0;
    const height = Number(base.height) || 0;
    const workWidth  = Number(base.workWidth)  || width;
    const workHeight = Number(base.workHeight) || height;
    let dpr = 1;
    if (os.platform() === 'darwin') {
        try {
            const sp = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' });
            const spJson = sp.status === 0 && sp.stdout ? JSON.parse(sp.stdout) : null;
            const displays = spJson?.SPDisplaysDataType;
            if (Array.isArray(displays) && displays.length > 0) {
                const first = displays[0];
                const gpus = first?._items;
                const maybe = Array.isArray(gpus) && gpus.length > 0 ? gpus[0] : first;
                const isRetina = maybe?.spdisplays_retina === 'spdisplays_yes' || maybe?.spdisplays_retina === true;
                if (isRetina) dpr = 2;
            }
        } catch {
            if (width >= 2560 && height >= 1440) dpr = 2;
        }
    }
    return { width, height, workWidth, workHeight, source: base.source || 'unknown', dpr };
}

async function loadCamoufox() {
    try {
        return await import('camoufox');
    } catch (err) {
        const mod = await import('node:module');
        const require = mod.createRequire(import.meta.url);
        return require('camoufox');
    }
}

/**
 * Launch a Camoufox (Firefox) browser context.
 * Returns a Playwright-compatible BrowserContext.
 *
 * @param {Object} opts
 * @param {string} opts.engine      - Must be 'camoufox'
 * @param {boolean} opts.headless   - Run headless
 * @param {string} opts.profileDir  - Firefox profile directory
 * @param {Object} opts.viewport    - { width, height }
 * @param {string} opts.userAgent   - Override user agent
 * @param {string} opts.locale      - Browser locale
 * @param {string} opts.timezoneId  - Timezone ID
 */
export async function launchEngineContext(opts) {
    if (opts.engine !== 'camoufox') {
        throw new CamoError({ code: 'E_BROWSER_UNSUPPORTED_ENGINE', details: { engine: opts.engine } });
    }

    const dm = getDisplayMetricsWithDPR();
    const physicalW = Math.floor(Number(dm?.width  || 4096));
    const physicalH = Math.floor(Number(dm?.height || 2304));
    const workW     = Math.floor(Number(dm?.workWidth  || physicalW || 4096));
    const workH     = Math.floor(Number(dm?.workHeight || physicalH || 2190));

    const requestedW = Number(opts.viewport?.width  || process.env.CAMO_VIEWPORT_WIDTH  || 1440);
    const requestedH = Number(opts.viewport?.height || process.env.CAMO_VIEWPORT_HEIGHT || 1100);
    const viewportW  = Math.max(900,  Math.floor(requestedW));
    const viewportH  = Math.max(700,  Math.floor(requestedH));

    const envHeadlessW = Number(process.env.CAMO_HEADLESS_WIDTH  || 0);
    const envHeadlessH = Number(process.env.CAMO_HEADLESS_HEIGHT || 0);
    const headlessW    = envHeadlessW > 0 ? envHeadlessW : viewportW;
    const headlessH    = envHeadlessH > 0 ? envHeadlessH : viewportH;

    if (!Number.isFinite(headlessW) || !Number.isFinite(headlessH)) {
        throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'viewport', reason: 'invalid headless dimensions' } });
    }

    const headless = Boolean(opts.headless);

    const maxHeadfulW = workW > 0 ? Math.max(900,  workW - 40)  : 1920;
    const maxHeadfulH = workH > 0 ? Math.max(700,  workH - 80)  : 1200;
    const winW = headless ? Math.floor(headlessW)  : Math.min(viewportW, maxHeadfulW);
    const winH = headless ? Math.floor(headlessH)  : Math.min(viewportH, maxHeadfulH);

    const camoufox = await loadCamoufox();
    const Camoufox = camoufox.Camoufox;
    if (!Camoufox) {
        throw new CamoError({ code: 'E_BROWSER_LAUNCH_FAILED', details: { reason: 'camoufox_invalid_api' } });
    }
    const executablePath = String(opts.executablePath || process.env.CAMO_EXECUTABLE_PATH || '').trim();

    const targetOS = process.platform === 'win32' ? 'windows'
        : process.platform === 'darwin' ? 'macos' : 'linux';
    const isWindows = process.platform === 'win32';
    const useMinimalWindowsOptions = isWindows;

    const config = useMinimalWindowsOptions ? null : {
        'screen.width':       Math.floor(physicalW),
        'screen.height':      Math.floor(physicalH),
        'screen.availWidth':  Math.floor(workW),
        'screen.availHeight': Math.floor(workH),
        'window.screenX':     0,
        'window.screenY':     0,
        ...(opts.timezoneId ? { timezone: opts.timezoneId } : {}),
    };

    const firefox_user_prefs = useMinimalWindowsOptions ? null : {
        'browser.link.open_newwindow':                  3,
        'browser.link.open_newwindow.restriction':      0,
        'browser.link.open_newwindow.override.external': -1,
        'browser.tabs.loadInBackground':               false,
        'browser.tabs.loadDivertedInBackground':       false,
        'browser.tabs.closeWindowWithLastTab':         false,
        'browser.tabs.warnOnClose':                    false,
        'browser.tabs.tabMinWidth':                    50,
    };

    const result = await Camoufox({
        headless,
        os: targetOS,
        window: [Math.floor(winW) | 0, Math.floor(winH) | 0],
        viewport: headless ? { width: Math.floor(headlessW) | 0, height: Math.floor(headlessH) | 0 } : null,
        ...(firefox_user_prefs ? { firefox_user_prefs } : {}),
        ...(config ? { config } : {}),
        data_dir: opts.profileDir,
        ...(useMinimalWindowsOptions ? {} : { humanize: true }),
        iKnowWhatImDoing: true,
        ...(useMinimalWindowsOptions ? {} : { locale: opts.locale || 'zh-CN' }),
        ...(useMinimalWindowsOptions ? {} : {
            fonts: [
                'PingFang SC', 'Hiragino Sans GB', 'STHeiti',
                'Microsoft YaHei', 'SimHei', 'SimSun',
                'Microsoft JhengHei', 'Noto Sans CJK SC',
                'Source Han Sans SC', 'Arial Unicode MS',
                'Helvetica', 'Arial', 'Sans-Serif',
            ],
            custom_fonts_only: false,
        }),
        ...(opts.userAgent ? { extraHTTPHeaders: {} } : {}),
        ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
        ...(executablePath ? { executable_path: executablePath } : {}),
    });

    if (result && typeof result.pages === 'function') {
        return result;  // Already a BrowserContext
    }
    if (result && typeof result.newContext === 'function') {
        return await result.newContext();  // Browser -> new context
    }
    throw new CamoError({ code: 'E_BROWSER_LAUNCH_FAILED', details: { reason: 'camoufox_invalid_response' } });
}
