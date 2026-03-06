import { ContainerRegistry, } from './container-registry.js';
export class ContainerMatcher {
    registry;
    constructor(registry = new ContainerRegistry()) {
        this.registry = registry;
    }
    async matchRoot(session, pageContext) {
        const url = pageContext?.url;
        if (!url) {
            throw new Error('page_context.url is required');
        }
        const containers = this.registry.getContainersForUrl(url);
        if (!containers || !Object.keys(containers).length) {
            return null;
        }
        const page = await session.ensurePage(url);
        await this.waitForStableDom(page);
        const currentUrl = page.url() || url;
        const pagePath = this.safePathname(currentUrl);
        const rootContainers = Object.entries(containers)
            .filter(([containerId]) => !containerId.includes('.'))
            .sort((a, b) => this.scoreContainer(b[1]) - this.scoreContainer(a[1]));
        for (let attempt = 0; attempt < 3; attempt++) {
            for (const [containerId, containerDef] of rootContainers) {
                const match = await this.matchContainer(page, containerId, containerDef, currentUrl, pagePath);
                if (match) {
                    return match;
                }
            }
            try {
                await page.waitForTimeout(300);
            }
            catch {
                break;
            }
        }
        return null;
    }
    async inspectTree(session, pageContext, options = {}) {
        const url = pageContext?.url;
        if (!url) {
            throw new Error('page_context.url is required');
        }
        const containers = this.registry.getContainersForUrl(url);
        if (!containers || !Object.keys(containers).length) {
            throw new Error('No container definitions available for this URL');
        }
        const timings = [];
        const totalStart = Date.now();
        const page = await session.ensurePage(url);
        const waitStart = Date.now();
        await this.waitForStableDom(page);
        timings.push({ step: 'wait_for_dom', duration_ms: Date.now() - waitStart });
        const currentUrl = page.url() || url;
        const pagePath = this.safePathname(currentUrl);
        const maxDepth = this.clampNumber(options.max_depth ?? options.maxDepth ?? 4, 1, 6);
        const maxChildren = this.clampNumber(options.max_children ?? options.maxChildren ?? 6, 1, 12);
        const preferredRootId = options.root_container_id || options.root_id;
        const preferredSelector = options.root_selector;
        let rootMatch = null;
        const matchStart = Date.now();
        if (preferredRootId && containers[preferredRootId]) {
            rootMatch = await this.matchContainer(page, preferredRootId, containers[preferredRootId], currentUrl, pagePath);
        }
        if (!rootMatch) {
            rootMatch = await this.matchRoot(session, pageContext);
        }
        if (!rootMatch) {
            throw new Error('No DOM elements matched known containers');
        }
        timings.push({ step: 'match_root', duration_ms: Date.now() - matchStart });
        const effectiveSelector = preferredSelector || rootMatch.container?.matched_selector;
        const collectStart = Date.now();
        // 仅收集以根容器为起点的子树内的匹配结果，避免对当前页面无关的容器做全量扫描
        const subtreeIds = this.collectSubtreeIds(containers, rootMatch.container.id);
        const matchMap = await this.collectContainerMatches(page, containers, effectiveSelector, undefined, subtreeIds);
        timings.push({ step: 'collect_container_matches', duration_ms: Date.now() - collectStart });
        const buildTreeStart = Date.now();
        const containerTree = this.buildContainerTree(containers, rootMatch.container.id, matchMap);
        timings.push({ step: 'build_container_tree', duration_ms: Date.now() - buildTreeStart });
        const domCaptureStart = Date.now();
        const matchedPaths = [];
        if (matchMap) {
            for (const result of Object.values(matchMap)) {
                if (result.nodes && Array.isArray(result.nodes)) {
                    for (const node of result.nodes) {
                        if (node.dom_path)
                            matchedPaths.push(node.dom_path);
                    }
                }
            }
        }
        const domTree = await this.captureDomTreeWithRetry(page, effectiveSelector, maxDepth, maxChildren, matchedPaths);
        timings.push({ step: 'capture_dom_tree', duration_ms: Date.now() - domCaptureStart });
        const annotateStart = Date.now();
        const annotations = this.buildDomAnnotations(matchMap);
        this.attachDomAnnotations(domTree, annotations);
        timings.push({ step: 'annotate_dom', duration_ms: Date.now() - annotateStart });
        timings.push({ step: 'total', duration_ms: Date.now() - totalStart });
        return {
            root_match: rootMatch,
            container_tree: containerTree,
            dom_tree: domTree,
            matches: matchMap,
            metadata: {
                captured_at: Date.now(),
                max_depth: maxDepth,
                max_children: maxChildren,
                root_selector: effectiveSelector || null,
                root_container_id: rootMatch.container.id || null,
                page_url: currentUrl,
                page_path: pagePath,
                timings,
            },
        };
    }
    async inspectDomBranch(session, pageContext, options = {}) {
        const url = pageContext?.url;
        if (!url) {
            throw new Error('page_context.url is required');
        }
        const path = this.normalizeDomPath(options.path || options.dom_path || options.node_path);
        if (!path) {
            throw new Error('DOM path is required');
        }
        const page = await session.ensurePage(url);
        await this.waitForStableDom(page);
        const maxDepth = this.clampNumber(options.max_depth ?? options.maxDepth ?? 4, 1, 6);
        const maxChildren = this.clampNumber(options.max_children ?? options.maxChildren ?? 6, 1, 20);
        const containers = this.registry.getContainersForUrl(url);
        const preferredRootId = options.root_container_id || options.root_id;
        const rootSelector = options.root_selector ||
            (await this.resolveRootSelector(session, pageContext, containers, preferredRootId));
        if (!rootSelector) {
            throw new Error('无法确定根容器选择器');
        }
        const branch = await this.captureDomBranch(page, rootSelector, path, maxDepth, maxChildren);
        if (!branch) {
            throw new Error('无法捕获 DOM 分支');
        }
        let annotations = {};
        if (containers && Object.keys(containers).length) {
            const matchSummary = await this.collectContainerMatches(page, containers, rootSelector, 8);
            annotations = this.buildDomAnnotations(matchSummary);
        }
        this.attachDomAnnotations(branch, annotations);
        return {
            path,
            node: branch,
            metadata: {
                captured_at: Date.now(),
                max_depth: maxDepth,
                max_children: maxChildren,
                root_selector: rootSelector,
            },
        };
    }
    async waitForStableDom(page) {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
            await page.waitForFunction(() => {
                const app = document.querySelector('#app');
                if (app && app.children.length > 0) {
                    return true;
                }
                return document.body?.children?.length > 2;
            }, { timeout: 12000 }).catch(() => { });
        }
        catch { }
    }
    async matchContainer(page, containerId, container, url, pagePath) {
        if (!this.matchesPagePatterns(container, url, pagePath)) {
            return null;
        }
        const selectors = container.selectors || [];
        if (!selectors.length) {
            console.warn('[container-matcher] container has no selectors', containerId);
            return null;
        }
        for (const selector of selectors) {
            const css = this.selectorToCss(selector);
            if (!css)
                continue;
            let handles = [];
            try {
                handles = await page.$$(css);
            }
            catch (err) {
                console.warn('[container-matcher] selector failed', css, err);
                continue;
            }
            const count = handles.length;
            if (!count) {
                console.warn('[container-matcher] selector matched 0 nodes', css);
                continue;
            }
            const guards = container.metadata || {};
            if (!(await this.evaluateGuards(handles[0], guards))) {
                await Promise.all(handles.map((h) => h.dispose().catch(() => { })));
                continue;
            }
            const payload = {
                container: {
                    id: container.id || containerId,
                    name: container.name,
                    type: container.type,
                    matched_selector: css,
                    match_count: count,
                    definition: container,
                },
                match_details: {
                    container_id: containerId,
                    selector_variant: selector.variant || 'primary',
                    selector_classes: selector.classes || [],
                    matched_selector: css,
                    page_url: url,
                    match_count: count,
                },
            };
            await Promise.all(handles.map((h) => h.dispose().catch(() => { })));
            return payload;
        }
        return null;
    }
    scoreContainer(container) {
        const meta = container.metadata || {};
        const req = Array.isArray(meta.required_descendants_any) ? meta.required_descendants_any.length : 0;
        const excl = Array.isArray(meta.excluded_descendants_any) ? meta.excluded_descendants_any.length : 0;
        const selectors = container.selectors || [];
        const specificSelector = selectors.some((s) => {
            const css = s.css || '';
            return css && css !== '#app';
        });
        return req * 2 + excl + (specificSelector ? 1 : 0);
    }
    selectorToCss(selector) {
        if (selector.css) {
            return selector.css;
        }
        if (selector.id) {
            return `#${selector.id}`;
        }
        if (selector.classes && selector.classes.length) {
            return selector.classes.map((cls) => `.${cls}`).join('');
        }
        return null;
    }
    matchesPagePatterns(container, pageUrl, pagePath) {
        const host = this.safeHostname(pageUrl);
        const patterns = container.page_patterns || container.pagePatterns;
        if (!patterns || !patterns.length) {
            return true;
        }
        const includes = [];
        const excludes = [];
        for (const pattern of patterns) {
            if (typeof pattern !== 'string')
                continue;
            if (pattern.startsWith('!')) {
                excludes.push(pattern.slice(1));
            }
            else {
                includes.push(pattern);
            }
        }
        for (const pattern of excludes) {
            if (this.valueMatchesPattern(pageUrl, pattern) ||
                this.valueMatchesPattern(pagePath, pattern) ||
                this.valueMatchesPattern(host, pattern)) {
                return false;
            }
        }
        if (!includes.length) {
            return true;
        }
        for (const pattern of includes) {
            if (this.valueMatchesPattern(pageUrl, pattern) ||
                this.valueMatchesPattern(pagePath, pattern) ||
                this.valueMatchesPattern(host, pattern)) {
                return true;
            }
        }
        return false;
    }
    patternMatch(value, pattern) {
        if (!pattern)
            return false;
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}$`);
        return regex.test(value);
    }
    valueMatchesPattern(value, pattern) {
        if (this.patternMatch(value, pattern)) {
            return true;
        }
        if (!pattern.includes('*') && value.includes(pattern)) {
            return true;
        }
        return false;
    }
    async evaluateGuards(handle, metadata) {
        const req = Array.isArray(metadata?.required_descendants_any)
            ? metadata.required_descendants_any
            : [];
        const excl = Array.isArray(metadata?.excluded_descendants_any)
            ? metadata.excluded_descendants_any
            : [];
        if (!req.length && !excl.length) {
            return true;
        }
        try {
            return await handle.evaluate((element, guards) => {
                const { reqSelectors, exclSelectors } = guards;
                if (Array.isArray(reqSelectors) && reqSelectors.length) {
                    const hasRequired = reqSelectors.some((sel) => {
                        try {
                            return !!element.querySelector(sel);
                        }
                        catch {
                            return false;
                        }
                    });
                    if (!hasRequired) {
                        return false;
                    }
                }
                if (Array.isArray(exclSelectors) && exclSelectors.length) {
                    const hasExcluded = exclSelectors.some((sel) => {
                        try {
                            return !!element.querySelector(sel);
                        }
                        catch {
                            return false;
                        }
                    });
                    if (hasExcluded) {
                        return false;
                    }
                }
                return true;
            }, {
                reqSelectors: req,
                exclSelectors: excl,
            });
        }
        catch {
            return false;
        }
    }
    clampNumber(value, min, max) {
        if (Number.isNaN(value))
            return min;
        return Math.max(min, Math.min(max, value));
    }
    async collectContainerMatches(page, containers, rootSelector, maxNodes = 4, onlyContainerIds) {
        const summary = {};
        for (const [containerId, container] of Object.entries(containers)) {
            if (onlyContainerIds && !onlyContainerIds.has(containerId)) {
                continue;
            }
            const selectors = [];
            const nodes = [];
            let matchCount = 0;
            for (const selector of container.selectors || []) {
                const css = this.selectorToCss(selector);
                if (!css)
                    continue;
                let handles = [];
                try {
                    handles = await page.$$(css);
                }
                catch {
                    continue;
                }
                const count = handles.length;
                if (!count) {
                    await Promise.all(handles.map((h) => h.dispose().catch(() => { })));
                    continue;
                }
                selectors.push(css);
                matchCount += count;
                for (const handle of handles.slice(0, maxNodes)) {
                    const info = await this.describeElement(handle, rootSelector);
                    if (info) {
                        info.selector = css;
                        nodes.push(info);
                    }
                }
                await Promise.all(handles.map((h) => h.dispose().catch(() => { })));
                if (nodes.length >= maxNodes) {
                    break;
                }
            }
            summary[containerId] = {
                container: {
                    id: container.id || containerId,
                    name: container.name,
                    type: container.type,
                },
                selectors,
                match_count: matchCount,
                nodes,
            };
        }
        return summary;
    }
    collectSubtreeIds(containers, rootId) {
        const result = new Set();
        const visit = (containerId) => {
            if (result.has(containerId))
                return;
            const container = containers[containerId];
            if (!container)
                return;
            result.add(containerId);
            const childIds = this.resolveChildIds(containerId, container, containers);
            for (const childId of childIds) {
                visit(childId);
            }
        };
        visit(rootId);
        return result;
    }
    buildContainerTree(containers, rootId, matchMap) {
        const targetRoot = containers[rootId] ? rootId : this.inferFallbackRoot(containers, rootId);
        if (!targetRoot) {
            return null;
        }
        const build = (containerId) => {
            const container = containers[containerId];
            if (!container)
                return null;
            const childIds = this.resolveChildIds(containerId, container, containers);
            const node = {
                id: container.id || containerId,
                name: container.name,
                type: container.type,
                capabilities: container.capabilities || [],
                // 保留容器定义中的 metadata，供上层 UI 使用（例如 source_dom_path / 设计时信息）
                metadata: container.metadata ? { ...container.metadata } : undefined,
                selectors: (container.selectors || []).map((sel) => ({
                    ...sel,
                })),
                // 将容器定义中的 operations 透传给前端，用于浮窗编辑和演练。
                operations: Array.isArray(container.operations)
                    ? container.operations.map((op) => ({ ...op }))
                    : [],
                match: this.summarizeMatchPayload(containerId, matchMap),
                children: [],
            };
            for (const childId of childIds) {
                const childNode = build(childId);
                if (childNode) {
                    node.children.push(childNode);
                }
            }
            return node;
        };
        return build(targetRoot);
    }
    resolveChildIds(containerId, container, containers) {
        const declared = Array.isArray(container.children) ? container.children : [];
        const explicit = declared.filter((child) => Boolean(containers[child]));
        if (explicit.length) {
            return explicit;
        }
        const prefix = `${containerId}.`;
        const targetDepth = containerId.split('.').length;
        const fallback = [];
        for (const key of Object.keys(containers)) {
            if (!key.startsWith(prefix))
                continue;
            if (key.split('.').length === targetDepth + 1) {
                fallback.push(key);
            }
        }
        return fallback.sort();
    }
    inferFallbackRoot(containers, preferredId) {
        if (preferredId && containers[preferredId]) {
            return preferredId;
        }
        const topLevel = Object.keys(containers).filter((id) => !id.includes('.')).sort();
        if (topLevel.length)
            return topLevel[0];
        const keys = Object.keys(containers).sort();
        return keys[0] || null;
    }
    summarizeMatchPayload(containerId, matchMap) {
        const payload = matchMap[containerId] || {};
        return {
            match_count: payload.match_count || 0,
            selectors: payload.selectors || [],
            nodes: payload.nodes || [],
        };
    }
    async captureDomTreeWithRetry(page, selector, maxDepth, maxChildren, forcePaths) {
        const attempts = [];
        if (selector)
            attempts.push(selector);
        attempts.push('#app', 'body', null);
        const tried = new Set();
        for (const candidate of attempts) {
            const key = candidate ?? '__root__';
            if (tried.has(key))
                continue;
            tried.add(key);
            const retries = candidate && candidate === selector ? 5 : 3;
            for (let i = 0; i < retries; i++) {
                const outline = await this.captureDomTree(page, candidate || undefined, maxDepth, maxChildren, forcePaths);
                if (outline) {
                    return outline;
                }
                await page.waitForTimeout(250).catch(() => { });
            }
        }
        return this.captureFallbackDomTree(page, maxDepth, maxChildren);
    }
    async captureDomTree(page, selector, maxDepth, maxChildren, forcePaths) {
        const runtimeTree = await page
            .evaluate((config) => {
            const runtime = window.__camoRuntime;
            if (!runtime?.dom?.getBranch) {
                return null;
            }
            return runtime.dom.getBranch('root', {
                rootSelector: config.selector || null,
                maxDepth: config.maxDepth,
                maxChildren: config.maxChildren,
                forcePaths: config.forcePaths,
            });
        }, { selector, maxDepth, maxChildren, forcePaths })
            .catch(() => null);
        if (runtimeTree?.node) {
            const normalized = this.normalizeRuntimeNode(runtimeTree.node);
            if (normalized) {
                return normalized;
            }
        }
        return this.captureDomTreeLegacy(page, selector, maxDepth, maxChildren);
    }
    async captureDomTreeLegacy(page, selector, maxDepth, maxChildren) {
        try {
            return await page.evaluate((config) => {
                const target = config.selector ? document.querySelector(config.selector) : document.body;
                if (!target)
                    return null;
                const walk = (element, path, depth) => {
                    const meta = {
                        path: path.join('/'),
                        tag: element.tagName,
                        id: element.id || null,
                        classes: Array.from(element.classList || []),
                        childCount: element.children?.length || 0,
                        textSnippet: (element.textContent || '').trim().slice(0, 80),
                        children: [],
                    };
                    if (depth >= config.maxDepth) {
                        return meta;
                    }
                    const children = Array.from(element.children || []).slice(0, config.maxChildren);
                    meta.children = children.map((child, idx) => walk(child, path.concat(String(idx)), depth + 1));
                    return meta;
                };
                return walk(target, ['root'], 0);
            }, {
                selector,
                maxDepth,
                maxChildren,
            });
        }
        catch {
            return null;
        }
    }
    async captureFallbackDomTree(page, maxDepth, maxChildren) {
        try {
            return await page.evaluate((config) => {
                const root = document.body || document.documentElement;
                if (!root)
                    return null;
                const walk = (element, path, depth) => {
                    const meta = {
                        path: path.join('/'),
                        tag: element.tagName,
                        id: element.id || null,
                        classes: Array.from(element.classList || []),
                        childCount: element.children?.length || 0,
                        textSnippet: (element.textContent || '').trim().slice(0, 80),
                        children: [],
                    };
                    if (depth >= config.maxDepth) {
                        return meta;
                    }
                    const kids = Array.from(element.children || []).slice(0, config.maxChildren);
                    meta.children = kids.map((child, idx) => walk(child, path.concat(String(idx)), depth + 1));
                    return meta;
                };
                return walk(root, ['root'], 0);
            }, {
                maxDepth: Math.max(1, Math.min(Number(maxDepth) || 4, 8)),
                maxChildren: Math.max(1, Math.min(Number(maxChildren) || 8, 40)),
            });
        }
        catch {
            return null;
        }
    }
    buildDomAnnotations(matchMap) {
        const annotations = {};
        for (const [containerId, payload] of Object.entries(matchMap)) {
            const nodes = payload.nodes || [];
            for (const node of nodes) {
                const path = node.dom_path;
                if (!path)
                    continue;
                annotations[path] = annotations[path] || [];
                annotations[path].push({
                    container_id: containerId,
                    container_name: payload.container?.name || payload.container?.id,
                    selector: node.selector,
                });
            }
        }
        return annotations;
    }
    attachDomAnnotations(domTree, annotations) {
        if (!domTree)
            return;
        const visit = (node) => {
            node.containers = annotations[node.path] || [];
            for (const child of node.children || []) {
                visit(child);
            }
        };
        visit(domTree);
    }
    async captureDomBranch(page, selector, path, maxDepth, maxChildren) {
        const runtimeBranch = await page
            .evaluate((config) => {
            const runtime = window.__camoRuntime;
            if (!runtime?.dom?.getBranch) {
                return null;
            }
            return runtime.dom.getBranch(config.path, {
                rootSelector: config.selector,
                maxDepth: config.maxDepth,
                maxChildren: config.maxChildren,
            });
        }, { selector, path, maxDepth, maxChildren })
            .catch(() => null);
        if (runtimeBranch?.node) {
            return this.normalizeRuntimeNode(runtimeBranch.node);
        }
        return this.captureDomBranchLegacy(page, selector, path, maxDepth, maxChildren);
    }
    async captureDomBranchLegacy(page, selector, path, maxDepth, maxChildren) {
        try {
            return await page.evaluate((config) => {
                const normalizePath = (raw) => {
                    if (!raw)
                        return ['root'];
                    const tokens = raw.split('/').filter((token) => token.length);
                    if (!tokens.length || tokens[0] === '__root__') {
                        tokens[0] = 'root';
                    }
                    if (tokens[0] !== 'root') {
                        tokens.unshift('root');
                    }
                    return tokens;
                };
                const pathParts = normalizePath(config.path);
                const root = document.querySelector(config.selector);
                if (!root)
                    return null;
                const resolvePath = (node, parts, index) => {
                    if (!node)
                        return null;
                    if (index >= parts.length)
                        return node;
                    const targetIdx = Number(parts[index]);
                    const childNodes = Array.from(node.children ?? []);
                    if (!Number.isFinite(targetIdx) || targetIdx < 0 || targetIdx >= childNodes.length) {
                        return null;
                    }
                    return resolvePath(childNodes[targetIdx], parts, index + 1);
                };
                const startNode = resolvePath(root, pathParts, 1);
                if (!startNode)
                    return null;
                const walk = (element, pathTokens, depth) => {
                    const meta = {
                        path: pathTokens.join('/'),
                        tag: element.tagName,
                        id: element.id || null,
                        classes: Array.from(element.classList || []),
                        childCount: element.children?.length || 0,
                        textSnippet: (element.textContent || '').trim().slice(0, 80),
                        children: [],
                    };
                    if (depth >= config.maxDepth) {
                        return meta;
                    }
                    const children = Array.from(element.children || []).slice(0, config.maxChildren);
                    meta.children = children.map((child, idx) => walk(child, pathTokens.concat(String(idx)), depth + 1));
                    return meta;
                };
                return walk(startNode, pathParts, 0);
            }, {
                selector,
                path,
                maxDepth,
                maxChildren,
            });
        }
        catch {
            return null;
        }
    }
    async describeElement(handle, rootSelector) {
        try {
            return await handle.evaluate((element, selector) => {
                const resolvedRoot = selector ? document.querySelector(selector) : null;
                const computePath = (root) => {
                    const indices = [];
                    let current = element;
                    let guard = 0;
                    let foundRoot = false;
                    while (current && guard < 80) {
                        if (root && current === root) {
                            foundRoot = true;
                            break;
                        }
                        const parent = current.parentElement;
                        if (!parent)
                            break;
                        const idx = Array.prototype.indexOf.call(parent.children || [], current);
                        indices.unshift(String(idx));
                        current = parent;
                        guard += 1;
                    }
                    return {
                        path: ['root', ...indices].join('/'),
                        foundRoot,
                    };
                };
                const rootPathInfo = resolvedRoot ? computePath(resolvedRoot) : null;
                const useRoot = Boolean(rootPathInfo?.foundRoot);
                const domPath = useRoot ? rootPathInfo?.path : null;
                const classes = Array.from(element.classList || []);
                const snippet = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                return {
                    dom_path: domPath,
                    dom_root_selector: useRoot ? selector : null,
                    tag: element.tagName,
                    id: element.id || null,
                    classes,
                    textSnippet: snippet,
                };
            }, rootSelector || null);
        }
        catch {
            return null;
        }
        finally {
            try {
                await handle.dispose();
            }
            catch {
                // ignore
            }
        }
    }
    safePathname(raw) {
        try {
            return new URL(raw).pathname || '/';
        }
        catch {
            return raw;
        }
    }
    safeHostname(raw) {
        try {
            return new URL(raw).hostname || '';
        }
        catch {
            return '';
        }
    }
    normalizeDomPath(path) {
        if (!path)
            return null;
        const tokens = path.split('/').filter((token) => token.length);
        if (!tokens.length)
            return 'root';
        if (tokens[0] === '__root__') {
            tokens[0] = 'root';
        }
        if (tokens[0] !== 'root') {
            tokens.unshift('root');
        }
        return tokens.join('/');
    }
    normalizeRuntimeNode(node) {
        if (!node)
            return null;
        const normalizedPath = this.normalizeDomPath(node.path || 'root') || 'root';
        const normalized = {
            path: normalizedPath,
            tag: node.tag ? String(node.tag).toUpperCase() : 'DIV',
            id: node.id || null,
            classes: Array.isArray(node.classes) ? [...node.classes] : [],
            childCount: typeof node.childCount === 'number'
                ? node.childCount
                : Array.isArray(node.children)
                    ? node.children.length
                    : 0,
            textSnippet: node.textSnippet || node.text || '',
            selector: node.selector || null,
            containers: Array.isArray(node.containers) ? [...node.containers] : [],
            children: [],
        };
        if (Array.isArray(node.children)) {
            normalized.children = node.children
                .map((child, index) => {
                if (!child.path) {
                    child.path = `${normalizedPath}/${index}`;
                }
                return this.normalizeRuntimeNode(child);
            })
                .filter(Boolean);
        }
        return normalized;
    }
    async resolveRootSelector(session, pageContext, containers, preferredId) {
        if (!containers || !Object.keys(containers).length) {
            const match = await this.matchRoot(session, pageContext);
            return match?.container?.matched_selector || null;
        }
        if (preferredId && containers[preferredId]) {
            const page = await session.ensurePage(pageContext.url);
            const match = await this.matchContainer(page, preferredId, containers[preferredId], pageContext.url, this.safePathname(pageContext.url));
            if (match?.container?.matched_selector) {
                return match.container.matched_selector;
            }
        }
        const rootMatch = await this.matchRoot(session, pageContext);
        return rootMatch?.container?.matched_selector || null;
    }
}
//# sourceMappingURL=container-matcher.js.map