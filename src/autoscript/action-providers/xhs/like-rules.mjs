import { normalizeArray } from '../../../container/runtime-core/utils.mjs';

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseLikeRuleToken(token) {
  const raw = normalizeText(token);
  if (!raw) return null;
  const matched = raw.match(/^\{\s*(.+?)\s*([+\-\uFF0B\uFF0D])\s*(.+?)\s*\}$/);
  if (!matched) {
    return { kind: 'contains', include: raw, raw };
  }
  const left = normalizeText(matched[1]);
  const right = normalizeText(matched[3]);
  if (!left || !right) return null;
  const op = matched[2] === '\uFF0B' ? '+' : matched[2] === '\uFF0D' ? '-' : matched[2];
  if (op === '+') {
    return { kind: 'and', includeA: left, includeB: right, raw: `{${left} + ${right}}` };
  }
  return { kind: 'include_without', include: left, exclude: right, raw: `{${left} - ${right}}` };
}

export function compileLikeRules(keywords) {
  const rules = [];
  for (const token of normalizeArray(keywords)) {
    const parsed = parseLikeRuleToken(token);
    if (parsed) rules.push(parsed);
  }
  return rules;
}

export function matchLikeText(textRaw, rules) {
  const text = normalizeText(textRaw);
  if (!text) return { ok: false, reason: 'empty_text' };
  if (!Array.isArray(rules) || rules.length === 0) return { ok: false, reason: 'no_rules' };

  for (const rule of rules) {
    if (rule.kind === 'contains') {
      if (text.includes(rule.include)) {
        return { ok: true, reason: 'contains_match', matchedRule: rule.raw };
      }
      continue;
    }
    if (rule.kind === 'and') {
      if (text.includes(rule.includeA) && text.includes(rule.includeB)) {
        return { ok: true, reason: 'and_match', matchedRule: rule.raw };
      }
      continue;
    }
    if (text.includes(rule.include) && !text.includes(rule.exclude)) {
      return { ok: true, reason: 'include_without_match', matchedRule: rule.raw };
    }
  }

  return { ok: false, reason: 'no_rule_match' };
}
