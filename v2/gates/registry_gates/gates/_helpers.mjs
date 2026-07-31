// Shared helpers for per-resource gates.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export const V1_ROOT = path.resolve(__dirname, '..', '..', '..', '..');  // repo root (camo)
export const V2_ROOT = path.resolve(__dirname, '..', '..', '..');          // v2/

export const PALETTE = {
  fail: '\u001b[31mFAIL\u001b[0m',
  pass: '\u001b[32mPASS\u001b[0m',
  warn: '\u001b[33mWARN\u001b[0m',
};

export function readRegistry() {
  const dir = path.join(V2_ROOT, 'resources', 'registry');
  return {
    resources: JSON.parse(fs.readFileSync(path.join(dir, 'resources.json'), 'utf8')),
    modules:   JSON.parse(fs.readFileSync(path.join(dir, 'modules.json'), 'utf8')),
  };
}

export function getResource(resource_id) {
  const { resources } = readRegistry();
  const r = resources.resources.find((x) => x.resource_id === resource_id);
  if (!r) throw new Error(`resource ${resource_id} missing from registry`);
  return r;
}

export function v1Shadows(forbiddenPath) {
  const bare = forbiddenPath.split('::')[0];
  const mapping = {
    'v2/lifecycle/session_registry.mjs':                  'src/lifecycle/session-registry.mjs',
    'v2/lifecycle/lock.mjs':                              'src/lifecycle/lock.mjs',
    'v2/services/browser_service/internal/container_matcher.js': 'src/services/browser-service/internal/container-matcher.js',
    'v2/services/browser_service/internal/page_runtime/runtime.js': 'src/services/browser-service/internal/page-runtime/runtime.js',
    'v2/services/browser_service/internal/engine_manager.js': 'src/services/browser-service/internal/engine-manager.js',
    'v2/services/browser_service/internal/process_cleanup.js': 'src/services/browser-service/internal/process-cleanup.js',
    'v2/services/browser_service/internal/browser_session/input_ops.js': 'src/services/browser-service/internal/browser-session/input-ops.js',
    'v2/services/browser_service/index.js': 'src/services/browser-service/index.js',
    'v2/core/actions.mjs':                                'src/core/actions.mjs',
    'v2/autoscript/action_providers/index.mjs':           'src/autoscript/action-providers/index.mjs',
    'v2/container/runtime_core/search.mjs':               'src/container/runtime-core/search.mjs',
    'v2/container/subscription_registry.mjs':             'src/container/subscription-registry.mjs',
    'v2/operations/tab_pool.mjs':                         'src/container/runtime-core/operations/tab-pool.mjs',
  };
  const v1 = mapping[bare];
  if (v1) return [path.join(V1_ROOT, v1)];
  return [];
}

export function checkForbiddenGone(resource_id) {
  const r = getResource(resource_id);
  const hits = [];
  for (const fp of r.forbidden_paths) {
    for (const shadow of v1Shadows(fp)) {
      if (fs.existsSync(shadow)) hits.push(path.relative(V1_ROOT, shadow));
    }
  }
  return { ok: hits.length === 0, hits, resource: r };
}

export function executeProhibitions(resource_id) {
    const { ok, hits, resource } = checkForbiddenGone(resource_id);
    return { ok, violations: hits, resource };
}

// Import analysis utilities
export function extractImportSpecifiers(text) {
    const results = [];
    const seen = new Set();

    // Match all forms: import x from 'y', import * as x from 'y', export {x} from 'y', export * from 'y'
    const staticImportPattern = /(?:import|export)\s+(?:(\*)|(\{[^}]*\}|[^;{]+?))\s*(?:as\s+\w+\s*)?from\s+['"`]([^'"`]+)['"`]/g;
    // Match dynamic import with single/double quotes only (NOT backticks)
    const dynamicImportPattern = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    // Match template literal dynamic import: import(`x`)
    const templateImportPattern = /(?:await\s+)?import\s*\(\s*`([^`]+)`\s*\)/g;

    let m;
    while ((m = staticImportPattern.exec(text)) !== null) {
        const [, isNamespace, namedPart, specifier] = m;
        if (isNamespace) {
            results.push({ specifier, type: 'namespace' });
        } else if (namedPart?.includes('{')) {
            const names = namedPart.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean);
            for (const name of names) {
                const baseName = name.split(/\s+as\s+/)[0].trim();
                results.push({ specifier, type: 'named', name: baseName });
            }
        } else if (namedPart) {
            results.push({ specifier, type: 'default', name: namedPart.trim() });
        }
    }

    while ((m = dynamicImportPattern.exec(text)) !== null) {
        results.push({ specifier: m[1], type: 'dynamic' });
    }
    while ((m = templateImportPattern.exec(text)) !== null) {
        results.push({ specifier: m[1], type: 'dynamic-template' });
    }

    return results;
}

export function prohibitedImportSymbols(opts) {
    const { text, sourcePath, targetPath, symbols } = opts;
    const detected = new Set();
    const specs = extractImportSpecifiers(text);
    const targetBasename = targetPath.split('/').pop();

    // Find variable declarations from dynamic imports: const x = await import('...');
    const varImportPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const varNames = new Map();
    let m;
    while ((m = varImportPattern.exec(text)) !== null) {
        varNames.set(m[1], m[2]);
    }

    function matchesTarget(bare) {
        return bare === targetPath || bare === targetBasename || bare.endsWith('/' + targetBasename) || targetPath.includes(bare);
    }

    // Check each static import specifier
    for (const { specifier, type, name } of specs) {
        if (!specifier) continue;
        const bare = specifier.split('?')[0].split('#')[0];
        if (!matchesTarget(bare)) continue;
        if (type === 'namespace' || type === 'dynamic' || type === 'dynamic-template') {
            detected.add('*');
        } else if (type === 'named' && name) {
            if (symbols.includes(name)) detected.add(name);
        }
    }

    // Check variable-assigned dynamic imports for symbol access
    for (const [varName, specifier] of varNames) {
        const bare = specifier.split('?')[0].split('#')[0];
        if (matchesTarget(bare)) {
            for (const sym of symbols) {
                if (text.includes(varName + '.' + sym + '(')) {
                    detected.add('*');
                    break;
                }
            }
        }
    }

    // Detect variable-based dynamic imports without literal specifier
    // e.g. const target = 'path'; await import(target);
    const variableImportPattern = /(?:await\s+)?import\s*\(\s*(\w+)\s*\)/g;
    while ((m = variableImportPattern.exec(text)) !== null) {
        const varName = m[1];
        // Check if this variable was assigned a target-matching value
        const varAssignPattern = /(?:const|let|var)\s+\w+\s*=\s*['"]([^'"]+)['"]/;
        for (const line of text.split('\n')) {
            const match = line.match(varAssignPattern);
            if (match && match[1] === varName) {
                continue; // skip self-assignment
            }
            if (match) {
                const bare = match[1].split('?')[0].split('#')[0];
                if (matchesTarget(bare)) {
                    detected.add('*');
                }
            }
        }
    }

    return [...detected].sort();
}

export function prohibitedImportModules(opts) {
    const { text, moduleName } = opts;
    const detected = new Set();
    const specs = extractImportSpecifiers(text);

    for (const { specifier, type } of specs) {
        if (!specifier) continue;
        const bare = specifier.split('?')[0].split('#')[0];
        if (bare === moduleName || bare.startsWith(moduleName + '/')) {
            if (type === 'dynamic' || type === 'dynamic-template') {
                detected.add(specifier);
            } else if (type === 'namespace') {
                // Namespace import of exact match or subpath
                detected.add('*');
            } else {
                if (bare === moduleName) {
                    detected.add(moduleName);
                } else {
                    detected.add(bare);
                }
            }
        }
    }

    // Variable-assigned dynamic imports
    const lines = text.split('\n');
    for (const line of lines) {
        const match = line.match(/(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (match) {
            const importedBare = match[1].split('?')[0].split('#')[0];
            if (importedBare === moduleName || importedBare.startsWith(moduleName + '/')) {
                detected.add('<dynamic>');
            }
        }
    }

    return [...detected].sort();
}
