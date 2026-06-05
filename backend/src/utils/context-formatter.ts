/**
 * Converts an AppMetadataSchema object into a Markdown document
 * suitable for AI coding tools and developer onboarding.
 */

import type { AppMetadataSchema } from '@insforge/shared-schemas';

export function formatContextAsMarkdown(metadata: AppMetadataSchema): string {
  const lines: string[] = [];
  /** Escape pipes + newlines for Markdown table cells. */
  const esc = (s: unknown) =>
    String(s ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  /** Strip backticks and newlines for inline code spans. */
  const code = (s: unknown) =>
    String(s ?? '')
      .replace(/`/g, '')
      .replace(/\n/g, ' ');

  lines.push('# Project Metadata');
  if (metadata.version) {
    lines.push(`> v${metadata.version}`);
  }
  lines.push('');

  // Auth
  lines.push('## Auth');
  const auth = metadata.auth;
  if (auth) {
    if (auth.oAuthProviders?.length) {
      lines.push(`- **OAuth providers**: ${auth.oAuthProviders.join(', ')}`);
    }
    if (auth.customOAuthProviders?.length) {
      lines.push(`- **Custom OAuth providers**: ${auth.customOAuthProviders.join(', ')}`);
    }
    lines.push(
      `- **Email verification**: ${auth.requireEmailVerification ? 'required' : 'not required'}`
    );
    lines.push(`- **Signup**: ${auth.disableSignup ? 'disabled' : 'enabled'}`);
  }
  lines.push('');

  // Database
  lines.push('## Database');
  const db = metadata.database;
  if (db) {
    if (db.tables?.length) {
      lines.push('| Table | Records |');
      lines.push('|-------|---------|');
      for (const t of db.tables) {
        lines.push(`| ${esc(t.tableName)} | ${t.recordCount} |`);
      }
      lines.push('');
    }
    lines.push(`- **Total size**: ${db.totalSizeInGB} GB`);
    if (db.hint) {
      lines.push(`- **Hint**: ${code(db.hint)}`);
    }
  }
  lines.push('');

  // Storage
  lines.push('## Storage');
  const storage = metadata.storage;
  if (storage) {
    if (storage.buckets?.length) {
      for (const b of storage.buckets) {
        lines.push(
          `- \`${code(b.name)}\` — ${b.public ? 'public' : 'private'}, ${b.objectCount ?? 0} objects`
        );
      }
    } else {
      lines.push('No storage buckets configured.');
    }
    lines.push(`- **Total size**: ${storage.totalSizeInGB} GB`);
  }
  lines.push('');

  // Edge Functions
  lines.push('## Edge Functions');
  if (metadata.functions?.length) {
    for (const f of metadata.functions) {
      lines.push(
        `- \`${code(f.slug)}\` — ${code(f.status)}${f.description ? `: ${code(f.description)}` : ''}`
      );
    }
  } else {
    lines.push('No edge functions deployed.');
  }
  lines.push('');

  // Realtime
  if (metadata.realtime) {
    lines.push('## Realtime');
    if (metadata.realtime.channels?.length) {
      for (const ch of metadata.realtime.channels) {
        lines.push(
          `- \`${code(ch.pattern)}\`${ch.description ? ` — ${code(ch.description)}` : ''}`
        );
      }
    } else {
      lines.push('No realtime channels configured.');
    }
    lines.push('');
  }

  return lines.join('\n');
}
