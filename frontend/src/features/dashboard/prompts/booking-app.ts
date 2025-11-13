export const notionClonePrompt = {
  title: 'Notion Clone',
  description: 'Paste below prompts to your agent as a quick start for building real apps',
  prompt: `Make a notes app like Notion with these features:

• User authentication for sign in and sign out
• Pages list in a sidebar with create and delete
• Each page has a title and rich text or simple markdown content
• Support private pages for each user and public pages visible to all users
• Search over page titles
• Clean and minimal interface with white space and a neutral color palette
• Focus on readable text with minimal distractions
• Optional file attachments stored in InsForge storage and shown inside the page`,
  features: ['Authentication', 'Database', 'Storage'],
};
