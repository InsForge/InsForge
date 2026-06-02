/**
 * Converts a structured project context object into a Markdown document
 * suitable for AI coding tools and developer onboarding.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function formatContextAsMarkdown(context: any): string {
  const lines: string[] = [];
  /** Escape pipes + newlines for Markdown table cells. */
  const esc = (s: unknown) =>
    String(s ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  /** Strip newlines for inline code spans (pipes are safe inside backticks). */
  const code = (s: unknown) => String(s ?? '').replace(/\n/g, ' ');

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
        lines.push(`- \`${code(s.name)}\`${s.isProtected ? ' (protected)' : ''}`);
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
            lines.push(
              `| ${esc(col.columnName)} | ${esc(col.dataType)} | ${nullable} | ${esc(def)} |`
            );
          }
          lines.push('');
        }

        // Foreign keys
        if (tableData.foreignKeys?.length) {
          lines.push('**Foreign keys:**');
          for (const fk of tableData.foreignKeys) {
            lines.push(
              `- \`${code(fk.columnName)}\` → \`${code(fk.foreignTableName)}.${code(fk.foreignColumnName)}\``
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
            lines.push(`- \`${code(p.policyname)}\` (${code(p.cmd)}) — roles: ${code(p.roles)}`);
          }
          lines.push('');
        }

        // Indexes
        if (tableData.indexes?.length) {
          lines.push('**Indexes:**');
          for (const idx of tableData.indexes) {
            const flags = [idx.isPrimary && 'PK', idx.isUnique && 'UNIQUE']
              .filter(Boolean)
              .join(', ');
            lines.push(`- \`${code(idx.indexname)}\`${flags ? ` (${flags})` : ''}`);
          }
          lines.push('');
        }

        // Triggers
        if (tableData.triggers?.length) {
          lines.push('**Triggers:**');
          for (const t of tableData.triggers) {
            lines.push(
              `- \`${code(t.triggerName)}\` — ${code(t.actionTiming)} ${code(t.eventManipulation)}`
            );
          }
          lines.push('');
        }
      }
    }

    // Database functions (stored procedures)
    if (db.dbFunctions?.length) {
      lines.push('### Database Functions');
      for (const f of db.dbFunctions) {
        const kind = f.kind === 'p' ? 'procedure' : 'function';
        lines.push(`- \`${code(f.functionName)}\` (${kind})`);
      }
      lines.push('');
    }

    // Views
    if (db.views?.length) {
      lines.push('### Views');
      for (const v of db.views) {
        lines.push(`- \`${code(v.viewName)}\``);
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
          `- \`${code(b.name)}\` — ${b.public ? 'public' : 'private'}, ${b.objectCount ?? 0} objects`
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
      lines.push(
        `- \`${code(f.slug)}\` — ${code(f.status)}${f.description ? `: ${code(f.description)}` : ''}`
      );
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
      lines.push(`- \`${code(ch.name)}\``);
    }
  } else {
    lines.push('No realtime channels configured.');
  }
  lines.push('');

  return lines.join('\n');
}
