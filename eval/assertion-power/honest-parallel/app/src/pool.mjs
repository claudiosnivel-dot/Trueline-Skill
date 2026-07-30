export const POOL_LIMITS = { error_issues: 24 };
export function limit(v) { return v.slice(0, POOL_LIMITS.error_issues); }
