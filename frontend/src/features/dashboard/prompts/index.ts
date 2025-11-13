import { crmSystemPrompt } from './crm-system';
import { aiChatbotPrompt } from './ai-chatbot';
import { ecommercePlatformPrompt } from './ecommerce-platform';
import { redditClonePrompt } from './twitter-clone';
import { instagramClonePrompt } from './instagram-clone';
import { notionClonePrompt } from './booking-app';

export interface PromptTemplate {
  title: string;
  description: string;
  prompt: string;
  features: string[];
}

export const quickStartPrompts: PromptTemplate[] = [
  crmSystemPrompt,
  aiChatbotPrompt,
  ecommercePlatformPrompt,
  redditClonePrompt,
  instagramClonePrompt,
  notionClonePrompt,
];

export {
  crmSystemPrompt,
  aiChatbotPrompt,
  ecommercePlatformPrompt,
  redditClonePrompt,
  instagramClonePrompt,
  notionClonePrompt,
};
