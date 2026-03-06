import { normalizeSelectors } from './selectors.js';
import { inferSiteFromContainerId, resolveSiteKeyFromUrl } from './container-index.js';
import { readUserContainerDefinition, writeUserContainerDefinition } from './container-storage.js';

export function createContainerActionHandlers(ctx) {
  const {
    getContainerIndex,
    fetchInspectorSnapshot,
    fetchInspectorBranch,
    fetchContainerMatch,
    userContainerRoot,
    errorHandler,
  } = ctx;

  async function handleContainerInspect(payload = {}) {
    const profile = payload.profile;
    if (!profile) throw new Error('缺少 profile');
    const context = await fetchInspectorSnapshot({
      profile,
      url: payload.url,
      maxDepth: payload.maxDepth,
      maxChildren: payload.maxChildren,
      containerId: payload.containerId,
      rootSelector: payload.rootSelector,
    });
    const snapshot = context.snapshot;
    return {
      success: true,
      data: {
        sessionId: context.sessionId,
        profileId: context.profileId,
        url: context.targetUrl,
        snapshot,
        containerSnapshot: snapshot,
        domTree: snapshot?.dom_tree || null,
      },
    };
  }

  async function handleContainerInspectContainer(payload = {}) {
    if (!payload.profile) throw new Error('缺少 profile');
    if (!payload.containerId) throw new Error('缺少 containerId');
    const context = await fetchInspectorSnapshot({
      profile: payload.profile,
      url: payload.url,
      maxDepth: payload.maxDepth,
      maxChildren: payload.maxChildren,
      containerId: payload.containerId,
      rootSelector: payload.rootSelector,
    });
    return {
      success: true,
      data: {
        sessionId: context.sessionId,
        profileId: context.profileId,
        url: context.targetUrl,
        snapshot: context.snapshot,
      },
    };
  }

  async function handleContainerInspectBranch(payload = {}) {
    if (!payload.profile) throw new Error('缺少 profile');
    if (!payload.path) throw new Error('缺少 DOM 路径');
    const context = await fetchInspectorBranch({
      profile: payload.profile,
      url: payload.url,
      path: payload.path,
      rootSelector: payload.rootSelector,
      maxDepth: payload.maxDepth,
      maxChildren: payload.maxChildren,
    });
    return {
      success: true,
      data: {
        sessionId: context.sessionId,
        profileId: context.profileId,
        url: context.targetUrl,
        branch: context.branch,
      },
    };
  }

  async function handleContainerRemap(payload = {}) {
    const containerId = payload.containerId || payload.id;
    const selector = (payload.selector || '').trim();
    const definition = payload.definition || {};
    if (!containerId) throw new Error('缺少容器 ID');
    if (!selector) throw new Error('缺少新的 selector');
    const siteKey =
      payload.siteKey ||
      resolveSiteKeyFromUrl(payload.url, getContainerIndex()) ||
      inferSiteFromContainerId(containerId);
    if (!siteKey) throw new Error('无法确定容器所属站点');
    const normalizedDefinition = { ...definition, id: containerId };
    const existingSelectors = Array.isArray(normalizedDefinition.selectors) ? normalizedDefinition.selectors : [];
    const filtered = existingSelectors.filter((item) => (item?.css || '').trim() && (item.css || '').trim() !== selector);
    normalizedDefinition.selectors = [{ css: selector, variant: 'primary', score: 1 }, ...filtered];
    await writeUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, definition: normalizedDefinition });
    return handleContainerInspect({ profile: payload.profile, url: payload.url });
  }

  async function handleContainerCreateChild(payload = {}) {
    const parentId = payload.parentId || payload.parent_id;
    const containerId = payload.containerId || payload.childId || payload.id;
    if (!parentId) throw new Error('缺少父容器 ID');
    if (!containerId) throw new Error('缺少子容器 ID');
    const siteKey =
      payload.siteKey ||
      resolveSiteKeyFromUrl(payload.url, getContainerIndex()) ||
      inferSiteFromContainerId(containerId) ||
      inferSiteFromContainerId(parentId);
    if (!siteKey) throw new Error('无法确定容器所属站点');
    const selectorEntries = normalizeSelectors(payload.selectors || payload.selector || []) || [];
    if (!selectorEntries.length) throw new Error('缺少 selector 定义');
    const parentDefinition = (await readUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId: parentId, errorHandler })) || { id: parentId, children: [] };
    const normalizedChild = {
      ...(payload.definition || {}),
      id: containerId,
      selectors: selectorEntries,
      name: payload.definition?.name || payload.alias || containerId,
      type: payload.definition?.type || 'section',
      capabilities:
        Array.isArray(payload.definition?.capabilities) && payload.definition.capabilities.length
          ? payload.definition.capabilities
          : ['highlight', 'find-child', 'scroll'],
    };
    const alias = typeof payload.alias === 'string' ? payload.alias.trim() : '';
    const metadata = { ...(normalizedChild.metadata || {}) };
    if (alias) {
      metadata.alias = alias;
      normalizedChild.alias = alias;
      normalizedChild.nickname = alias;
      if (!normalizedChild.name) normalizedChild.name = alias;
    } else {
      delete metadata.alias;
    }
    if (payload.domPath) metadata.source_dom_path = payload.domPath;
    if (payload.domMeta && typeof payload.domMeta === 'object') metadata.source_dom_meta = payload.domMeta;
    normalizedChild.metadata = metadata;
    if (!normalizedChild.page_patterns || !normalizedChild.page_patterns.length) {
      const parentPatterns = parentDefinition.page_patterns || parentDefinition.pagePatterns;
      if (parentPatterns?.length) normalizedChild.page_patterns = parentPatterns;
    }
    const nextParent = { ...parentDefinition };
    const childList = Array.isArray(nextParent.children) ? [...nextParent.children] : [];
    if (!childList.includes(containerId)) childList.push(containerId);
    nextParent.children = childList;
    await writeUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, definition: normalizedChild });
    await writeUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId: parentId, definition: nextParent });
    return fetchContainerMatch({ profile: payload.profile, url: payload.url, maxDepth: payload.maxDepth, maxChildren: payload.maxChildren, rootSelector: payload.rootSelector });
  }

  async function handleContainerUpdateAlias(payload = {}) {
    const containerId = payload.containerId || payload.id;
    if (!containerId) throw new Error('缺少容器 ID');
    const alias = typeof payload.alias === 'string' ? payload.alias.trim() : '';
    const siteKey =
      payload.siteKey ||
      resolveSiteKeyFromUrl(payload.url, getContainerIndex()) ||
      inferSiteFromContainerId(containerId);
    if (!siteKey) throw new Error('无法确定容器所属站点');
    const baseDefinition = (await readUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, errorHandler })) || { id: containerId };
    const metadata = { ...(baseDefinition.metadata || {}) };
    if (alias) metadata.alias = alias; else delete metadata.alias;
    const next = { ...baseDefinition, name: baseDefinition.name || alias || containerId, metadata };
    if (alias) {
      next.alias = alias;
      next.nickname = alias;
    } else {
      delete next.alias;
      delete next.nickname;
    }
    await writeUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, definition: next });
    return handleContainerInspect({ profile: payload.profile, url: payload.url });
  }

  async function handleContainerUpdateOperations(payload = {}) {
    const containerId = payload.containerId || payload.id;
    if (!containerId) throw new Error('缺少容器 ID');
    const siteKey =
      payload.siteKey ||
      resolveSiteKeyFromUrl(payload.url, getContainerIndex()) ||
      inferSiteFromContainerId(containerId);
    if (!siteKey) throw new Error('无法确定容器所属站点');
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    const baseDefinition = (await readUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, errorHandler })) || { id: containerId };
    const next = { ...baseDefinition, operations };
    await writeUserContainerDefinition({ rootDir: userContainerRoot, siteKey, containerId, definition: next });
    return handleContainerInspect({ profile: payload.profile, url: payload.url, containerId });
  }

  async function handleContainerMatch(payload = {}) {
    return fetchContainerMatch(payload);
  }

  return {
    handleContainerInspect,
    handleContainerInspectContainer,
    handleContainerInspectBranch,
    handleContainerRemap,
    handleContainerCreateChild,
    handleContainerUpdateAlias,
    handleContainerUpdateOperations,
    handleContainerMatch,
  };
}
