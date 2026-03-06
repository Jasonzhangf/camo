import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
let resolvedRuntimePath = null;
function resolveRuntime() {
    if (resolvedRuntimePath)
        return resolvedRuntimePath;
    const base = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(process.cwd(), 'modules/camo-backend/src/internal/page-runtime/runtime.js'),
        path.join(process.cwd(), 'src/services/browser-service/internal/page-runtime/runtime.js'),
        path.join(base, 'page-runtime/runtime.js'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            resolvedRuntimePath = candidate;
            break;
        }
    }
    if (!resolvedRuntimePath) {
        throw new Error('Runtime script not found');
    }
    return resolvedRuntimePath;
}
export async function injectRuntimeBundle({ page }) {
    const runtimePath = resolveRuntime();
    console.log(`[runtimeInjector] injecting runtime from ${runtimePath}`);
    await page.addInitScript({ path: runtimePath });
    await page.addScriptTag({ path: runtimePath });
}
//# sourceMappingURL=runtimeInjector.js.map
