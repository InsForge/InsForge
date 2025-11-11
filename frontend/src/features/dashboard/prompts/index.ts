import { crmSystemPrompt } from './crm-system';
import { aiChatbotPrompt } from './ai-chatbot';
import { ecommercePlatformPrompt } from './ecommerce-platform';
import { twitterClonePrompt } from './twitter-clone';
import { instagramClonePrompt } from './instagram-clone';
import { bookingAppPrompt } from './booking-app';

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
  twitterClonePrompt,
  instagramClonePrompt,
  bookingAppPrompt,
];

export {
  crmSystemPrompt,
  aiChatbotPrompt,
  ecommercePlatformPrompt,
  twitterClonePrompt,
  instagramClonePrompt,
  bookingAppPrompt,
};
