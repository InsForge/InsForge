/** ISO-2 country code → flag emoji (Unicode regional-indicator math). */
export function flagEmoji(iso: string): string {
  if (!iso || iso.length !== 2) {
    return '';
  }
  const upper = iso.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + upper.charCodeAt(0) - 65,
    0x1f1e6 + upper.charCodeAt(1) - 65
  );
}

/** ISO-2 country code → English country name via Intl. Falls back to code on unsupported. */
let displayNames: Intl.DisplayNames | null = null;
function getDisplayNames(): Intl.DisplayNames {
  if (!displayNames) {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  }
  return displayNames;
}

export function countryName(iso: string): string {
  if (!iso) {
    return '';
  }
  try {
    return getDisplayNames().of(iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
}

/** Seconds → "mm:ss" (or "h:mm:ss" if ≥ 1h). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Number → locale-aware string with thousand separators. */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Pretty-format a percent with sign. */
export function formatPercent(pct: number, opts: { signed?: boolean } = {}): string {
  const rounded = Math.round(pct * 10) / 10;
  if (opts.signed) {
    if (rounded > 0) {
      return `+${rounded}%`;
    }
    if (rounded < 0) {
      return `${rounded}%`;
    }
    return '0%';
  }
  return `${rounded}%`;
}

/** Relative time: "5m ago", "2h ago", "3d ago". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  }
  if (diffSec < 86_400) {
    return `${Math.floor(diffSec / 3600)}h ago`;
  }
  return `${Math.floor(diffSec / 86_400)}d ago`;
}

/** Truncate distinct_id to a short readable form, e.g. "019ddbc3-272e…". */
export function truncateId(id: string, head = 12): string {
  if (!id) {
    return '';
  }
  if (id.length <= head + 1) {
    return id;
  }
  return `${id.slice(0, head)}…`;
}

/** Pretty-label common PostHog WebOverview keys. */
export function webOverviewLabel(key: string): string {
  switch (key) {
    case 'visitors':
      return 'Visitors';
    case 'views':
      return 'Pageviews';
    case 'sessions':
      return 'Sessions';
    case 'bounce_rate':
      return 'Bounce rate';
    case 'session_duration':
      return 'Avg duration';
    default:
      return key.replace(/_/g, ' ');
  }
}

/** Format a metric value per its key (visitors → integer, bounce_rate → "%", session_duration → mm:ss). */
export function webOverviewValue(key: string, value: number | null): string {
  if (value === null) {
    return '—';
  }
  if (key === 'bounce_rate') {
    return `${Math.round(value * 100)}%`;
  }
  if (key === 'session_duration') {
    return formatDuration(value);
  }
  return formatNumber(value);
}
