/**
 * Aggregates metadata from all services and provides
 * JSON / Markdown export for the admin metadata endpoint.
 */

import { AuthService } from '@/services/auth/auth.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { AppMetadataSchema } from '@insforge/shared-schemas';

export class MetadataService {
  private static instance: MetadataService;

  private constructor() {}

  static getInstance(): MetadataService {
    if (!MetadataService.instance) {
      MetadataService.instance = new MetadataService();
    }
    return MetadataService.instance;
  }

  async getAppMetadata(): Promise<AppMetadataSchema> {
    const authService = AuthService.getInstance();
    const dbManager = DatabaseManager.getInstance();
    const storageService = StorageService.getInstance();
    const functionService = FunctionService.getInstance();
    const realtimeChannelService = RealtimeChannelService.getInstance();
    const deploymentService = DeploymentService.getInstance();

    const [auth, database, storage, functions, realtime, deployments] = await Promise.all([
      authService.getMetadata(),
      dbManager.getMetadata(),
      storageService.getMetadata(),
      functionService.getMetadata(),
      realtimeChannelService.getMetadata(),
      deploymentService.getConfigMetadata(),
    ]);

    const version = process.env.npm_package_version || '1.0.0';

    return {
      auth,
      database,
      storage,
      functions,
      realtime,
      // Deployments slice is omitted entirely on self-hosted backends
      // (deploymentService.getConfigMetadata returns undefined). Cloud
      // projects see { customSlug: string | null }. The CLI capability
      // probe depends on this presence/absence signal to gate
      // [deployments] TOML sections.
      ...(deployments ? { deployments } : {}),
      version,
    };
  }

  formatAsMarkdown(metadata: AppMetadataSchema): string {
    const lines: string[] = [];

    /** Escape pipes + newlines for Markdown table cells. */
    const esc = (s: unknown) =>
      String(s ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ');

    /** Collapse newlines for plain-text interpolation. */
    const text = (s: unknown) => String(s ?? '').replace(/\n/g, ' ');

    /**
     * Wrap a value in a Markdown code span, using double-backtick
     * delimiters when the value itself contains backticks so that
     * no content characters are lost.
     */
    const codeSpan = (s: unknown) => {
      const str = String(s ?? '').replace(/\n/g, ' ');
      if (!str.includes('`')) return `\`${str}\``;
      return `\`\` ${str} \`\``;
    };

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
        lines.push(`- **Hint**: ${text(db.hint)}`);
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
            `- ${codeSpan(b.name)} — ${b.public ? 'public' : 'private'}, ${b.objectCount ?? 0} objects`
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
          `- ${codeSpan(f.slug)} — ${text(f.status)}${f.description ? `: ${text(f.description)}` : ''}`
        );
      }
    } else {
      lines.push('No edge functions deployed.');
    }
    lines.push('');

    // Deployments (cloud-only)
    if (metadata.deployments) {
      lines.push('## Deployments');
      const slug = metadata.deployments.customSlug;
      lines.push(`- **Custom slug**: ${slug ? codeSpan(slug) : 'not set'}`);
      lines.push('');
    }

    // Realtime
    if (metadata.realtime) {
      lines.push('## Realtime');
      if (metadata.realtime.channels?.length) {
        for (const ch of metadata.realtime.channels) {
          lines.push(
            `- ${codeSpan(ch.pattern)}${ch.description ? ` — ${text(ch.description)}` : ''}`
          );
        }
      } else {
        lines.push('No realtime channels configured.');
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
