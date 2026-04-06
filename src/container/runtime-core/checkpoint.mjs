import { callAPI, getDomSnapshotByProfile } from '../../utils/browser-service.mjs';
import {
  asErrorPayload,
  buildSelectorCheck,
  ensureActiveSession,
  getCurrentUrl,
  isCheckpointRiskUrl,
  maybeSelector,
  normalizeArray,
} from './utils.mjs';

// Default empty checkpoints - platform-specific checkpoints should be provided by caller
const DEFAULT_CHECKPOINTS = {
  search_ready: [],
  home_ready: [],
  detail_ready: [],
  comments_ready: [],
  login_guard: [],
  risk_control: [],
};

/**
 * Detect checkpoint based on DOM selectors.
 * @param {Object} options
 * @param {string} options.profileId - Browser profile ID
 * @param {string} [options.platform='generic'] - Platform identifier
 * @param {Object} [options.checkpoints] - Platform-specific selectors
 * @param {string[]} [options.checkpoints.search_ready] - Selectors for search page
 * @param {string[]} [options.checkpoints.home_ready] - Selectors for home page
 * @param {string[]} [options.checkpoints.detail_ready] - Selectors for detail page
 * @param {string[]} [options.checkpoints.comments_ready] - Selectors for comments section
 * @param {string[]} [options.checkpoints.login_guard] - Selectors for login dialog
 * @param {string[]} [options.checkpoints.risk_control] - Selectors for risk control page
 * @param {string} [options.platformHost] - Expected hostname (e.g., 'xiaohongshu.com')
 */
export async function detectCheckpoint({ 
  profileId, 
  platform = 'generic',
  checkpoints = DEFAULT_CHECKPOINTS,
  platformHost = null,
}) {
  try {
    const session = await ensureActiveSession(profileId);
    const resolvedProfile = session.profileId || profileId;

    const [url, snapshot] = await Promise.all([
      getCurrentUrl(resolvedProfile),
      getDomSnapshotByProfile(resolvedProfile),
    ]);

    const signals = [];
    const counter = {};
    const addCount = (label, selectors) => {
      for (const css of selectors) {
        const count = buildSelectorCheck(snapshot, css).length;
        if (count > 0) {
          counter[css] = count;
          signals.push(`${label}:${css}`);
        }
      }
    };

    addCount('search_ready', checkpoints.search_ready || []);
    addCount('home_ready', checkpoints.home_ready || []);
    addCount('detail_ready', checkpoints.detail_ready || []);
    addCount('comments_ready', checkpoints.comments_ready || []);
    addCount('login_guard', checkpoints.login_guard || []);
    addCount('risk_control', checkpoints.risk_control || []);

    let checkpoint = 'unknown';
    if (!url || (platformHost && !url.includes(platformHost))) checkpoint = 'offsite';
    else if (isCheckpointRiskUrl(url)) checkpoint = 'risk_control';
    else if (signals.some((item) => item.startsWith('login_guard:'))) checkpoint = 'login_guard';
    else if (signals.some((item) => item.startsWith('comments_ready:'))) checkpoint = 'comments_ready';
    else if (signals.some((item) => item.startsWith('detail_ready:'))) checkpoint = 'detail_ready';
    else if (signals.some((item) => item.startsWith('search_ready:'))) checkpoint = 'search_ready';
    else if (signals.some((item) => item.startsWith('home_ready:'))) checkpoint = 'home_ready';

    return {
      ok: true,
      code: 'CHECKPOINT_DETECTED',
      message: 'Checkpoint detected',
      data: {
        profileId: resolvedProfile,
        platform,
        checkpoint,
        url,
        signals,
        selectorHits: counter,
      },
    };
  } catch (err) {
    return asErrorPayload('CHECKPOINT_DETECT_FAILED', err?.message || String(err));
  }
}

export async function captureCheckpoint({
  profileId,
  containerId = null,
  selector = null,
  platform = 'generic',
  checkpoints = DEFAULT_CHECKPOINTS,
  platformHost = null,
}) {
  try {
    const session = await ensureActiveSession(profileId);
    const resolvedProfile = session.profileId || profileId;
    const checkpointRes = await detectCheckpoint({ 
      profileId: resolvedProfile, 
      platform,
      checkpoints,
      platformHost,
    });
    const effectiveSelector = maybeSelector({ profileId: resolvedProfile, containerId, selector });
    const snapshot = await getDomSnapshotByProfile(resolvedProfile);
    const matched = effectiveSelector ? buildSelectorCheck(snapshot, effectiveSelector) : [];

    return {
      ok: true,
      code: 'CHECKPOINT_CAPTURED',
      message: 'Checkpoint captured',
      data: {
        profileId: resolvedProfile,
        containerId,
        selector,
        checkpoint: checkpointRes.data?.checkpoint || 'unknown',
        matched: matched.length,
        snapshot: snapshot ? true : false,
        url: checkpointRes.data?.url,
      },
    };
  } catch (err) {
    return asErrorPayload('CHECKPOINT_CAPTURE_FAILED', err?.message || String(err));
  }
}

export async function restoreCheckpoint({
  profileId,
  checkpointData,
  platform = 'generic',
  checkpoints = DEFAULT_CHECKPOINTS,
  platformHost = null,
}) {
  try {
    const session = await ensureActiveSession(profileId);
    const resolvedProfile = session.profileId || profileId;
    
    // Basic restore logic - navigate to URL if provided
    if (checkpointData?.url) {
      await callAPI('goto', { profileId: resolvedProfile, url: checkpointData.url });
    }

    const checkpointAfter = await detectCheckpoint({ 
      profileId: resolvedProfile, 
      platform,
      checkpoints,
      platformHost,
    });

    return {
      ok: true,
      code: 'CHECKPOINT_RESTORED',
      message: 'Checkpoint restored',
      data: {
        profileId: resolvedProfile,
        checkpointBefore: checkpointData?.checkpoint || 'unknown',
        checkpointAfter: checkpointAfter.data?.checkpoint || 'unknown',
        url: checkpointAfter.data?.url,
      },
    };
  } catch (err) {
    return asErrorPayload('CHECKPOINT_RESTORE_FAILED', err?.message || String(err));
  }
}

// Export empty default for backward compatibility
export const XHS_CHECKPOINTS = DEFAULT_CHECKPOINTS;
