// camo v2 tracer. Module id=shell.tracer.
//
// Distributed tracing for command execution.

export function createTracer(options = {}) {
  const traces = new Map();
  let currentTraceId = options.traceId || null;
  let parentSpanId = null;

  function generateId(prefix = '') {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return prefix ? `${prefix}-${id}` : id;
  }

  function startTrace(name, opts = {}) {
    const traceId = currentTraceId || generateId('trace');
    const spanId = generateId('span');
    const span = {
      traceId,
      spanId,
      name,
      parentSpanId: opts.parent || parentSpanId,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      events: [],
      metadata: opts.metadata || {},
      status: 'running',
    };
    traces.set(spanId, span);
    currentTraceId = traceId;
    parentSpanId = spanId;
    return span;
  }

  function endSpan(spanId, status = 'ok', error = null) {
    const span = traces.get(spanId);
    if (!span) return null;
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (error) {
      span.error = {
        message: error.message,
        code: error.code || 'UNKNOWN',
        stack: error.stack,
      };
    }
    return span;
  }

  function addEvent(spanId, name, data = {}) {
    const span = traces.get(spanId);
    if (!span) return;
    span.events.push({
      name,
      timestamp: Date.now(),
      data,
    });
  }

  function getTrace(traceId) {
    const result = [];
    for (const span of traces.values()) {
      if (span.traceId === traceId) {
        result.push(span);
      }
    }
    return result;
  }

  function getAllTraces() {
    const byTrace = new Map();
    for (const span of traces.values()) {
      if (!byTrace.has(span.traceId)) {
        byTrace.set(span.traceId, []);
      }
      byTrace.get(span.traceId).push(span);
    }
    return byTrace;
  }

  function clear() {
    traces.clear();
    currentTraceId = null;
    parentSpanId = null;
  }

  return {
    startTrace,
    endSpan,
    addEvent,
    getTrace,
    getAllTraces,
    clear,
    getCurrentTraceId: () => currentTraceId,
    setTraceId: (id) => { currentTraceId = id; },
  };
}
