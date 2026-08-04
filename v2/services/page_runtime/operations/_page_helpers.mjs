// Shared helpers for page operations. Single truth_owner.
//
// This module provides reusable helper functions for all page operations.
// It has no side effects and throws no errors on its own.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { getPage } from '../../browser_service/internal/camoufox_bridge.mjs';
import { append as appendProgress } from '../../progress_event/log.mjs';

/**
 * Validate and normalize a profileId.
 * @param {string} id - profile identifier
 * @param {string} field - field name for error messages
 * @returns {string} normalized profileId
 */
export function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

/**
 * Get the browser page for a profileId or throw.
 * @param {string} profileId - profile identifier
 * @returns {Object} Playwright/Camoufox page
 */
export function getPageOrThrow(profileId) {
  const pid = safeId(profileId, 'profileId');
  const page = getPage(pid);
  if (!page) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'page', profileId: pid } });
  }
  return page;
}

/**
 * Get the browser record for a profileId or throw.
 * @param {string} profileId - profile identifier
 * @returns {Object} browser record with browser/context/page
 */
export function getBrowserOrThrow(profileId) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = require('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
  if (!record) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  }
  return record;
}

/**
 * Emit a progress event for a page operation.
 * @param {string} profileId - profile identifier
 * @param {string} type - event type (e.g., 'goto.start', 'click.done')
 * @param {Object} payload - event payload
 */
export function emit(profileId, type, payload) {
  appendProgress({ event: type, source: 'page_ops', profileId, payload, ts: new Date().toISOString() });
}

/**
 * Normalize a URL to ensure it starts with http:// or https://.
 * @param {string} url - URL to validate
 * @returns {string} normalized URL
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'url' } });
  }
  if (!/^https?:\/\//.test(url)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url', value: url, reason: 'must start with http:// or https://' } });
  }
  return url;
}

/**
 * Normalize a selector to ensure it's a non-empty string.
 * @param {string} selector - CSS selector
 * @param {string} field - field name for error messages
 * @returns {string|null} normalized selector or null
 */
export function normalizeSelector(selector, field = 'selector') {
  if (typeof selector === 'string' && selector.length > 0) {
    return selector;
  }
  return null;
}

/**
 * Check if an element locator has text content to find.
 * @param {Object} page - Playwright page
 * @param {string|null} selector - CSS selector
 * @param {string|null} text - text to find
 * @returns {Object} locator and metadata
 */
export function resolveLocator(page, selector, text) {
  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  return {
    hasSelector,
    hasText,
    locator: hasText ? page.getByText(text, { exact: false }) : (hasSelector ? page.locator(selector) : null),
  };
}
