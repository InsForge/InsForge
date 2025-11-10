import { crmSystemPrompt } from './crm-system';
import { aiChatbotPrompt } from './ai-chatbot';
import { taskTrackerPrompt } from './task-tracker';
import { socialMediaAppPrompt } from './social-media-app';
import { ecommercePlatformPrompt } from './ecommerce-platform';

export interface PromptTemplate {
  title: string;
  description: string;
  prompt: string;
  features: string[];
}

export const quickStartPrompts: PromptTemplate[] = [
  crmSystemPrompt,
  aiChatbotPrompt,
  taskTrackerPrompt,
  socialMediaAppPrompt,
  ecommercePlatformPrompt,
];

export {
  crmSystemPrompt,
  aiChatbotPrompt,
  taskTrackerPrompt,
  socialMediaAppPrompt,
  ecommercePlatformPrompt,
};
