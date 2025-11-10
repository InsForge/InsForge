export { type DatabaseTemplate } from './types';
export { crmSystemTemplate } from './crm-system';
export { ecommerceTemplate } from './e-commerce';
export { aiChatbotTemplate } from './ai-chatbot';
export { todoListTemplate } from './todo-list';

import { crmSystemTemplate } from './crm-system';
import { ecommerceTemplate } from './e-commerce';
import { aiChatbotTemplate } from './ai-chatbot';
import { todoListTemplate } from './todo-list';

export const DATABASE_TEMPLATES = [
  crmSystemTemplate,
  ecommerceTemplate,
  aiChatbotTemplate,
  todoListTemplate,
];
