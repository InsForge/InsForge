import type { InsforgeConfig } from './schema.js';

export type DiffChange =
  | {
      section: 'auth';
      op: 'modify';
      key: keyof NonNullable<InsforgeConfig['auth']>;
      from: unknown;
      to: unknown;
    }
  | { section: 'storage.buckets'; op: 'add'; key: string; value: { public?: boolean } }
  | {
      section: 'storage.buckets';
      op: 'modify';
      key: string;
      field: 'public';
      from: boolean;
      to: boolean;
    }
  | { section: 'storage.buckets'; op: 'remove'; key: string; kept: boolean };

export interface DiffSummary {
  add: number;
  modify: number;
  remove: number;
  kept: number;
}

export interface DiffResult {
  changes: DiffChange[];
  summary: DiffSummary;
}

export interface DiffInput {
  live: InsforgeConfig;
  file: InsforgeConfig;
  prune?: boolean;
}

export function diffConfig({ live, file, prune = false }: DiffInput): DiffResult {
  const changes: DiffChange[] = [];

  // --- auth ---
  const liveAuth = live.auth ?? {};
  const fileAuth = file.auth ?? {};
  for (const key of [
    'jwt_expiry',
    'enable_signup',
    'site_url',
    'additional_redirect_urls',
  ] as const) {
    if (!(key in fileAuth)) {
      continue;
    }
    const fromV = (liveAuth as Record<string, unknown>)[key];
    const toV = (fileAuth as Record<string, unknown>)[key];
    if (!deepEqual(fromV, toV)) {
      changes.push({ section: 'auth', op: 'modify', key, from: fromV, to: toV });
    }
  }

  // --- storage.buckets ---
  const liveBuckets = live.storage?.buckets ?? {};
  const fileBuckets = file.storage?.buckets ?? {};

  for (const [name, fileB] of Object.entries(fileBuckets)) {
    const liveB = liveBuckets[name];
    if (!liveB) {
      changes.push({ section: 'storage.buckets', op: 'add', key: name, value: fileB });
      continue;
    }
    if (fileB.public !== undefined && fileB.public !== liveB.public) {
      changes.push({
        section: 'storage.buckets',
        op: 'modify',
        key: name,
        field: 'public',
        from: liveB.public ?? false,
        to: fileB.public,
      });
    }
  }

  for (const name of Object.keys(liveBuckets)) {
    if (!(name in fileBuckets)) {
      changes.push({ section: 'storage.buckets', op: 'remove', key: name, kept: !prune });
    }
  }

  return { changes, summary: summarize(changes) };
}

function summarize(changes: DiffChange[]): DiffSummary {
  const s: DiffSummary = { add: 0, modify: 0, remove: 0, kept: 0 };
  for (const c of changes) {
    if (c.op === 'add') {
      s.add++;
    } else if (c.op === 'modify') {
      s.modify++;
    } else if (c.op === 'remove') {
      if (c.kept) {
        s.kept++;
      } else {
        s.remove++;
      }
    }
  }
  return s;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}
