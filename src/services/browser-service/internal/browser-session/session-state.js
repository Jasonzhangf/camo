import { createEmptyRecordingState } from './types.js';
export function createInitialSessionState(options) {
    return {
        options,
        browser: undefined,
        context: undefined,
        page: undefined,
        mode: 'dev',
        lastKnownUrl: null,
        lastCookieSignature: null,
        lastCookieSaveTs: 0,
        lastViewport: {
            lastViewport: null,
            followWindowViewport: !options.headless,
        },
        fingerprint: null,
        recording: createEmptyRecordingState(),
        recordingStream: null,
        exitNotified: false,
        wheelMode: String(process.env.CAMO_SCROLL_INPUT_MODE || '').trim().toLowerCase() === 'keyboard'
            ? 'keyboard'
            : 'wheel',
    };
}
export function getActivePage(state) {
    if (state.page && !state.page.isClosed()) {
        return state.page;
    }
    if (!state.context)
        return null;
    const alive = state.context.pages().find((p) => !p.isClosed());
    if (alive) {
        state.page = alive;
        return alive;
    }
    state.page = undefined;
    return null;
}
//# sourceMappingURL=session-state.js.map