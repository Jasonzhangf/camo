export function resolveProfileId(args, argIndex, getDefaultProfile) {
  let profileId = args[argIndex];
  if (!profileId) {
    profileId = getDefaultProfile();
  }
  return profileId;
}

export function ensureUrlScheme(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function looksLikeUrlToken(token) {
  if (!token || typeof token !== 'string') return false;
  if (token.includes('://')) return true;
  return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/.test(token);
}

export function getPositionals(args, startIndex = 1) {
  return args.slice(startIndex).filter((a) => a && !a.startsWith('--'));
}
