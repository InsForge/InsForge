export interface ConnectorDef {
  id: 'apify';
  name: string;
  tagline: string;
  auth: 'oauth2' | 'api-key';
  skillsCount: number;
  consoleUrl: string;
  /** Example prompt shown in the connector dialog to paste into a coding agent. */
  examplePrompt: string;
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: 'apify',
    name: 'Apify',
    tagline: 'Web scraping & automation',
    auth: 'oauth2',
    skillsCount: 5,
    consoleUrl: 'https://console.apify.com',
    examplePrompt:
      'Use the apify-ultimate-scraper skill to scrape <what you want> and return the results.',
  },
];
