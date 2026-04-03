import os from 'node:os';
import { spawnSync } from 'node:child_process';
function readNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function getDisplayMetrics() {
    const envWidth = readNumber(process.env.CAMO_SCREEN_WIDTH || process.env.CAMO_SCREEN_WIDTH);
    const envHeight = readNumber(process.env.CAMO_SCREEN_HEIGHT || process.env.CAMO_SCREEN_HEIGHT);
    if (envWidth && envHeight) {
        return { width: envWidth, height: envHeight, source: 'env' };
    }
    if (os.platform() === 'darwin') {
        try {
            const sp = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' });
            const spJson = sp.status === 0 && sp.stdout ? JSON.parse(sp.stdout) : null;
            let width = null;
            let height = null;
            const displays = spJson?.SPDisplaysDataType;
            if (Array.isArray(displays) && displays.length > 0) {
                const first = displays[0];
                const gpus = first?._items;
                const maybe = Array.isArray(gpus) && gpus.length > 0 ? gpus[0] : first;
                const resStr = maybe?.spdisplays_ndrvs?.[0]?._spdisplays_resolution || maybe?._spdisplays_resolution;
                if (typeof resStr === 'string') {
                    const m = resStr.match(/(\d+)\s*x\s*(\d+)/i);
                    if (m) {
                        width = readNumber(m[1]);
                        height = readNumber(m[2]);
                    }
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
            const workWidth = readNumber(vf?.workWidth);
            const workHeight = readNumber(vf?.workHeight);
            if (!finalW || !finalH)
                return null;
            return {
                width: finalW,
                height: finalH,
                ...(workWidth ? { workWidth } : {}),
                ...(workHeight ? { workHeight } : {}),
                source: 'darwin',
            };
        }
        catch {
            return null;
        }
    }
    if (os.platform() !== 'win32')
        return null;
    try {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$screen=[System.Windows.Forms.Screen]::PrimaryScreen;',
            '$b=$screen.Bounds;',
            '$w=$screen.WorkingArea;',
            '$video=Get-CimInstance Win32_VideoController | Select-Object -First 1;',
            '$nw=$null;$nh=$null;',
            'if ($video) { $nw=$video.CurrentHorizontalResolution; $nh=$video.CurrentVerticalResolution }',
            '$o=[pscustomobject]@{width=$b.Width;height=$b.Height;workWidth=$w.Width;workHeight=$w.Height;nativeWidth=$nw;nativeHeight=$nh};',
            '$o | ConvertTo-Json -Compress',
        ].join(' ');
        const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8',
            windowsHide: true,
        });
        if (res.status !== 0 || !res.stdout)
            return null;
        const payload = JSON.parse(res.stdout.trim());
        const nativeWidth = readNumber(payload?.nativeWidth);
        const nativeHeight = readNumber(payload?.nativeHeight);
        const width = readNumber(payload?.width) || nativeWidth || null;
        const height = readNumber(payload?.height) || nativeHeight || null;
        const workWidth = readNumber(payload?.workWidth);
        const workHeight = readNumber(payload?.workHeight);
        if (!width || !height)
            return null;
        return {
            width,
            height,
            ...(workWidth ? { workWidth } : {}),
            ...(workHeight ? { workHeight } : {}),
            ...(nativeWidth ? { nativeWidth } : {}),
            ...(nativeHeight ? { nativeHeight } : {}),
            source: 'win32',
        };
    }
    catch {
        return null;
    }
}
function getDisplayMetricsWithDPR() {
    const dm = getDisplayMetrics();
    const base = dm ? { ...dm } : {};
    const width = Number(base.width) || 0;
    const height = Number(base.height) || 0;
    const workWidth = Number(base.workWidth) || width;
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
                if (isRetina)
                    dpr = 2;
            }
        }
        catch {
            if (width >= 2560 && height >= 1440)
                dpr = 2;
        }
    }
    return { width, height, workWidth, workHeight, source: base.source || 'unknown', dpr };
}
async function loadCamoufox() {
    // Prefer dynamic import; fall back to require for NodeNext interop edge cases.
    try {
        return await import('camoufox');
    }
    catch (err) {
        const mod = await import('node:module');
        const require = mod.createRequire(import.meta.url);
        return require('camoufox');
    }
}
export async function launchEngineContext(opts) {
    if (opts.engine === 'camoufox') {
        // Camoufox/Firefox is sensitive to non-integer window placement/size values.
        // In practice, when the underlying launch path attempts to derive screenY/screenX from floats,
        // Firefox can crash with: "Invalid type for property window.screenY. Expected int, got number".
        // Also, we want the window size to reflect the *real* OS work area so later system clicks
        // have enough usable viewport.
        // Prefer OS work area (real screen resolution) for window size; fall back to viewport.
        const dm = getDisplayMetricsWithDPR();
        // Physical display size from OS
        const physicalW = Number(dm?.width || 4096);
        const physicalH = Number(dm?.height || 2304);
        const workW = Number(dm?.workWidth || physicalW || 4096);
        const workH = Number(dm?.workHeight || physicalH || 2190);
        // Base viewport target:
        // - prefer explicit/fingerprint viewport if provided
        // - otherwise use a deterministic default for stable first-run UX
    const requestedW = Number(opts.viewport?.width || process.env.CAMO_VIEWPORT_WIDTH || process.env.CAMO_VIEWPORT_WIDTH || 1440);
    const requestedH = Number(opts.viewport?.height || process.env.CAMO_VIEWPORT_HEIGHT || process.env.CAMO_VIEWPORT_HEIGHT || 1100);
        const viewportW = Math.max(900, Math.floor(Number(requestedW) || 1440));
        const viewportH = Math.max(700, Math.floor(Number(requestedH) || 1100));
    const envHeadlessW = Number(process.env.CAMO_HEADLESS_WIDTH || process.env.CAMO_HEADLESS_WIDTH || 0);
    const envHeadlessH = Number(process.env.CAMO_HEADLESS_HEIGHT || process.env.CAMO_HEADLESS_HEIGHT || 0);
        const headlessW = envHeadlessW > 0 ? envHeadlessW : viewportW;
        const headlessH = envHeadlessH > 0 ? envHeadlessH : viewportH;
        if (!Number.isFinite(headlessW) || !Number.isFinite(headlessH)) {
            throw new Error('headless viewport invalid');
        }
        const headless = Boolean(opts.headless);
        // Final headful window size:
        // align window with viewport by default and keep it inside available work area.
        const maxHeadfulW = workW > 0 ? Math.max(900, workW - 40) : 1920;
        const maxHeadfulH = workH > 0 ? Math.max(700, workH - 80) : 1200;
        const winW = headless ? headlessW : Math.min(viewportW, maxHeadfulW);
        const winH = headless ? headlessH : Math.min(viewportH, maxHeadfulH);
        // Ensure integer types for Camoufox
        const screenW = Math.floor(physicalW) | 0;
        const screenH = Math.floor(physicalH) | 0;
        const intWinW = Math.floor(winW) | 0;
        const intWinH = Math.floor(winH) | 0;
        // Firefox/Camoufox requires screenX/screenY to be integers; default to 0 to avoid float errors.
        const camoufox = await loadCamoufox();
        const Camoufox = camoufox.Camoufox;
        if (!Camoufox)
            throw new Error('camoufox_invalid_api');
        const targetOS = process.platform === 'win32'
            ? 'windows'
            : process.platform === 'darwin'
                ? 'macos'
                : 'linux';
        const isWindows = process.platform === 'win32';
        const useMinimalWindowsOptions = isWindows;
        // Build config to force actual display dimensions (without screen constraints to avoid position calc issues)
        const config = useMinimalWindowsOptions
            ? null
            : {
                'screen.width': Math.floor(physicalW),
                'screen.height': Math.floor(physicalH),
                'screen.availWidth': Math.floor(workW),
                'screen.availHeight': Math.floor(workH),
                'window.screenX': 0,
                'window.screenY': 0,
            };
        // Force tabs to open in same window (not new windows)
        const firefox_user_prefs = useMinimalWindowsOptions
            ? null
            : {
                // Force all new windows (including script popups) to open as tabs
                'browser.link.open_newwindow': 3,
                'browser.link.open_newwindow.restriction': 0,
                'browser.link.open_newwindow.override.external': -1,
                // Make sure tab strip is visible and no single-window mode
                'browser.tabs.loadInBackground': false,
                'browser.tabs.loadDivertedInBackground': false,
                'browser.tabs.closeWindowWithLastTab': false,
                'browser.tabs.warnOnClose': false,
                'browser.tabs.tabMinWidth': 50,
            };
        const result = await Camoufox({
            headless,
            os: targetOS,
            window: [intWinW, intWinH],
            viewport: headless ? { width: headlessW, height: headlessH } : null,
            ...(firefox_user_prefs ? { firefox_user_prefs } : {}),
            ...(config ? { config } : {}),
            data_dir: opts.profileDir,
            ...(useMinimalWindowsOptions ? {} : { humanize: true }),
            iKnowWhatImDoing: true,
            ...(useMinimalWindowsOptions ? {} : { locale: 'zh-CN' }),
            ...(useMinimalWindowsOptions
                ? {}
                : {
                    fonts: [
                        'PingFang SC',
                        'Hiragino Sans GB',
                        'STHeiti',
                        'Microsoft YaHei',
                        'SimHei',
                        'SimSun',
                        'Microsoft JhengHei',
                        'Noto Sans CJK SC',
                        'Source Han Sans SC',
                        'Arial Unicode MS',
                        'Helvetica',
                        'Arial',
                        'Sans-Serif',
                    ],
                    custom_fonts_only: false,
                }),
        });
        if (result && typeof result.pages === 'function') {
            // Already a BrowserContext
            return result;
        }
        if (result && typeof result.newContext === 'function') {
            // Browser -> create a new context
            return (await result.newContext());
        }
        throw new Error('camoufox_invalid_response');
    }
    throw new Error('chromium_removed');
}
//# sourceMappingURL=engine-manager.js.map
