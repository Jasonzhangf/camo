import { callAPI } from '../../../utils/browser-service.mjs';

export function withOperationHighlight(script, color = '#ff7a00') {
  return `(() => {
    const flashNode = (node, duration = 420) => {
      if (!(node instanceof HTMLElement)) return;
      const prevOutline = node.style.outline;
      const prevOffset = node.style.outlineOffset;
      const prevTransition = node.style.transition;
      node.style.transition = 'outline 80ms ease';
      node.style.outline = '2px solid ${color}';
      node.style.outlineOffset = '2px';
      setTimeout(() => {
        node.style.outline = prevOutline;
        node.style.outlineOffset = prevOffset;
        node.style.transition = prevTransition;
      }, duration);
    };
    const flashViewport = (duration = 420) => {
      const root = document.documentElement;
      if (!(root instanceof HTMLElement)) return;
      const prevShadow = root.style.boxShadow;
      const prevTransition = root.style.transition;
      root.style.transition = 'box-shadow 80ms ease';
      root.style.boxShadow = 'inset 0 0 0 3px ${color}';
      setTimeout(() => {
        root.style.boxShadow = prevShadow;
        root.style.transition = prevTransition;
      }, duration);
    };
    flashViewport();
    const target = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : (document.body || document.documentElement);
    flashNode(target);
    return (${script});
  })()`;
}

export async function runEvaluateScript({ profileId, script, highlight = true }) {
  const wrappedScript = highlight ? withOperationHighlight(script) : script;
  return callAPI('evaluate', { profileId, script: wrappedScript });
}

export function extractEvaluateResultData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if ('result' in payload) return payload.result;
  if (payload.data && typeof payload.data === 'object' && 'result' in payload.data) {
    return payload.data.result;
  }
  return null;
}

export function extractScreenshotBase64(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.data === 'string' && payload.data) return payload.data;
  if (payload.result && typeof payload.result === 'object' && typeof payload.result.data === 'string') {
    return payload.result.data;
  }
  if (payload.data && typeof payload.data === 'object' && typeof payload.data.data === 'string') {
    return payload.data.data;
  }
  return '';
}

export async function evaluateWithScript({ profileId, script, message, highlight }) {
  const result = await runEvaluateScript({ profileId, script, highlight });
  return { ok: true, code: 'OPERATION_DONE', message, data: result };
}

export function createEvaluateHandler(message, buildScript) {
  return async ({ profileId, params }) => {
    const script = buildScript(params);
    const highlight = params.highlight !== false;
    return evaluateWithScript({ profileId, script, message, highlight });
  };
}
