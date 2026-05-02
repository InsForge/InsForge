import { GetTableSchemaResponse } from '@insforge/shared-schemas';
import { crmSystemTemplate } from './crm-system';
import { aiChatbotTemplate } from './ai-chatbot';
import { ecommercePlatformTemplate } from './ecommerce-platform';
import { redditCloneTemplate } from './reddit-clone';
import { instagramCloneTemplate } from './instagram-clone';
import { notionCloneTemplate } from './notion-clone';

export interface DatabaseTemplate {
  id: string;
  title: string;
  description: string;
  tableCount: number;
  sql: string;
  visualizerSchema: GetTableSchemaResponse[];
}

export {
  crmSystemTemplate,
  aiChatbotTemplate,
  ecommercePlatformTemplate,
  redditCloneTemplate,
  instagramCloneTemplate,
  notionCloneTemplate,
};

export const DATABASE_TEMPLATES = [
  crmSystemTemplate,
  aiChatbotTemplate,
  ecommercePlatformTemplate,
  redditCloneTemplate,
  instagramCloneTemplate,
  notionCloneTemplate,
];
