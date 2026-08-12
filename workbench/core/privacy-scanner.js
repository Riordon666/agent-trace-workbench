const REDACTED = '[REDACTED]';

const CATEGORY_SEVERITY = {
  private_key: 'critical',
  anthropic_api_key: 'critical',
  openai_api_key: 'critical',
  github_token: 'critical',
  aws_access_key: 'critical',
  bearer_token: 'critical',
  authorization_field: 'critical',
  cookie_field: 'critical',
  api_key_field: 'critical',
  token_field: 'critical',
  credential_field: 'critical',
  windows_home_path: 'warning',
  posix_home_path: 'warning',
  email: 'warning',
  ip_address: 'info',
};

const DETECTORS = [
  { id: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { id: 'anthropic_api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g },
  { id: 'openai_api_key', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{12,}\b/g },
  { id: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g },
  { id: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi },
  { id: 'windows_home_path', pattern: /\b[A-Za-z]:\\Users\\[^\\\s"'<>]+(?:\\[^\s"'<>]*)?/g },
  { id: 'posix_home_path', pattern: /\/(?:Users|home)\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?/g },
  { id: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

const SENSITIVE_FIELDS = [
  { id: 'authorization_field', pattern: /^(?:proxy[-_])?authorization$/i },
  { id: 'cookie_field', pattern: /^(?:set[-_])?cookie$/i },
  { id: 'api_key_field', pattern: /^(?:x[-_])?(?:api[-_]?key|goog[-_]?api[-_]?key)$/i },
  { id: 'token_field', pattern: /^(?:access|auth|refresh|id)[-_]?token$/i },
  { id: 'credential_field', pattern: /^(?:password|passwd|private[-_]?key|client[-_]?secret)$/i },
];

function scanAndRedact(value) {
  const counts = Object.create(null);
  const redacted = visit(value, counts, '$');
  return { value: redacted, report: privacyReport(counts) };
}

function visit(value, counts, path) {
  if (Array.isArray(value)) return value.map((item, index) => visit(item, counts, `${path}[${index}]`));
  if (typeof value === 'string') return redactString(value, counts);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const detector = SENSITIVE_FIELDS.find((entry) => entry.pattern.test(key));
    if (detector && item !== null && item !== undefined && item !== '') {
      increment(counts, detector.id);
      return [key, REDACTED];
    }
    return [key, visit(item, counts, `${path}.${key}`)];
  }));
}

function redactString(value, counts) {
  let result = String(value);
  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0;
    result = result.replace(detector.pattern, () => {
      increment(counts, detector.id);
      return REDACTED;
    });
  }
  return result;
}

function privacyReport(counts = {}) {
  const byCategory = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)));
  const findings = Object.values(byCategory).reduce((sum, count) => sum + count, 0);
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const [category, count] of Object.entries(byCategory)) bySeverity[CATEGORY_SEVERITY[category] || 'warning'] += count;
  return {
    scanner_version: '1.0',
    findings,
    by_category: byCategory,
    by_severity: bySeverity,
    redacted: findings > 0,
    share_status: 'manual_review_required',
    manual_review_required: true,
    limitations: [
      'Pattern matching cannot identify every project-specific secret or sensitive prompt.',
      'Review every exported entry before sharing.',
    ],
  };
}

function mergePrivacyReports(...reports) {
  const counts = Object.create(null);
  for (const report of reports.flat().filter(Boolean)) {
    for (const [category, count] of Object.entries(report.by_category || {})) {
      counts[category] = (counts[category] || 0) + Number(count || 0);
    }
  }
  return privacyReport(counts);
}

function findSensitiveCategories(value) {
  return Object.keys(scanAndRedact(value).report.by_category);
}

function increment(counts, id) {
  counts[id] = (counts[id] || 0) + 1;
}

module.exports = {
  CATEGORY_SEVERITY,
  DETECTORS,
  REDACTED,
  SENSITIVE_FIELDS,
  findSensitiveCategories,
  mergePrivacyReports,
  privacyReport,
  scanAndRedact,
};
