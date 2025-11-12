import { GetTableSchemaResponse } from '@insforge/shared-schemas';
import { crmSystemTemplate } from './crm-system';
import { aiChatbotTemplate } from './ai-chatbot';
import { ecommercePlatformTemplate } from './ecommerce-platform';
import { twitterCloneTemplate } from './twitter-clone';
import { instagramCloneTemplate } from './instagram-clone';
import { bookingAppTemplate } from './booking-app';

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
  twitterCloneTemplate,
  instagramCloneTemplate,
  bookingAppTemplate,
};

export const DATABASE_TEMPLATES = [
  crmSystemTemplate,
  aiChatbotTemplate,
  ecommercePlatformTemplate,
  twitterCloneTemplate,
  instagramCloneTemplate,
  bookingAppTemplate,
];
