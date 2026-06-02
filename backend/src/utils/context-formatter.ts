/**
 * Converts a structured project context object into a Markdown document
 * suitable for AI coding tools and developer onboarding.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function formatContextAsMarkdown(context: any): string {
  const lines: string[] = [];

  lines.push(`# Project Context Export`);
  lines.push(`> Exported at ${context.exportedAt} · v${context.version}`);
  lines.push('');

  // Auth
  lines.push('## Auth');
  const auth = context.auth;
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
  const db = context.database;
  if (db) {
    if (db.schemas?.length) {
      lines.push(`### Schemas`);
      for (const s of db.schemas) {
        lines.push(`- \`${s.name}\`${s.isProtected ? ' (protected)' : ''}`);
      }
      lines.push('');
    }

    if (db.tables && typeof db.tables === 'object') {
      lines.push('### Tables');
      for (const [tableName, tableData] of Object.entries<any>(db.tables)) {
        lines.push(`#### ${tableName}`);

        // Columns
        if (tableData.schema?.length) {
          lines.push('| Column | Type | Nullable | Default |');
          lines.push('|--------|------|----------|---------|');
          for (const col of tableData.schema) {
            const nullable = col.isNullable === 'YES' ? 'yes' : 'no';
            const def = col.columnDefault ?? '-';
            lines.push(`| ${col.columnName} | ${col.dataType} | ${nullable} | ${def} |`);
          }
          lines.push('');
        }

        // Foreign keys
        if (tableData.foreignKeys?.length) {
          lines.push('**Foreign keys:**');
          for (const fk of tableData.foreignKeys) {
            lines.push(
              `- \`${fk.columnName}\` → \`${fk.foreignTableName}.${fk.foreignColumnName}\``
            );
          }
          lines.push('');
        }

        // RLS
        if (tableData.rlsEnabled) {
          lines.push('**RLS**: enabled');
        }

        // Policies
        if (tableData.policies?.length) {
          lines.push('**Policies:**');
          for (const p of tableData.policies) {
            lines.push(`- \`${p.policyname}\` (${p.cmd}) — roles: ${p.roles}`);
          }
          lines.push('');
        }
      }
    }

    // Indexes
    if (db.indexes?.length) {
      lines.push('### Indexes');
      for (const idx of db.indexes) {
        const flags = [idx.isPrimary && 'PK', idx.isUnique && 'UNIQUE'].filter(Boolean).join(', ');
        lines.push(`- \`${idx.indexName}\` on \`${idx.tableName}\`${flags ? ` (${flags})` : ''}`);
      }
      lines.push('');
    }

    // Policies (schema-level summary)
    if (db.policies?.length) {
      lines.push('### RLS Policies');
      for (const p of db.policies) {
        lines.push(`- \`${p.policyName}\` on \`${p.tableName}\` (${p.cmd}) — roles: ${p.roles}`);
      }
      lines.push('');
    }

    // Triggers
    if (db.triggers?.length) {
      lines.push('### Triggers');
      for (const t of db.triggers) {
        lines.push(
          `- \`${t.triggerName}\` on \`${t.tableName}\` — ${t.actionTiming} ${t.eventManipulation}`
        );
      }
      lines.push('');
    }
  }

  // Storage
  lines.push('## Storage');
  const storage = context.storage;
  if (storage) {
    if (storage.buckets?.length) {
      for (const b of storage.buckets) {
        lines.push(
          `- \`${b.name}\` — ${b.public ? 'public' : 'private'}, ${b.objectCount ?? 0} objects`
        );
      }
    } else {
      lines.push('No storage buckets configured.');
    }
    if (storage.totalSizeInGB !== undefined && storage.totalSizeInGB !== null) {
      lines.push(`- **Total size**: ${storage.totalSizeInGB} GB`);
    }
  }
  lines.push('');

  // Functions
  lines.push('## Edge Functions');
  const functions = context.functions;
  if (functions?.length) {
    for (const f of functions) {
      lines.push(`- \`${f.slug}\` — ${f.status}${f.description ? `: ${f.description}` : ''}`);
    }
  } else {
    lines.push('No edge functions deployed.');
  }
  lines.push('');

  // Realtime
  lines.push('## Realtime');
  const realtime = context.realtime;
  if (realtime?.channels?.length) {
    for (const ch of realtime.channels) {
      lines.push(`- \`${ch.name}\``);
    }
  } else {
    lines.push('No realtime channels configured.');
  }
  lines.push('');

  return lines.join('\n');
}
