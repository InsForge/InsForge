import { ReactElement } from 'react';
import Github from '@/assets/logos/github.svg?react';
import Google from '@/assets/logos/google.svg?react';
import Microsoft from '@/assets/logos/microsoft.svg?react';
import Discord from '@/assets/logos/discord.svg?react';
import LinkedIn from '@/assets/logos/linkedin.svg?react';
import Facebook from '@/assets/logos/facebook.svg?react';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';

export interface OAuthProviderInfo {
  id: OAuthProvidersSchema;
  name: string;
  icon: ReactElement;
  description: string;
  setupUrl: string;
}

export const oauthProviders: OAuthProviderInfo[] = [
  {
    id: 'google',
    name: 'Google OAuth',
    icon: <Google className="w-6 h-6" />,
    description: 'Configure Google authentication for your users',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'github',
    name: 'GitHub OAuth',
    icon: <Github className="w-6 h-6 dark:text-white" />,
    description: 'Configure GitHub authentication for your users',
    setupUrl: 'https://github.com/settings/developers',
  },
  {
    id: 'microsoft',
    name: 'Microsoft OAuth',
    icon: <Microsoft className="w-6 h-6 dark:text-white" />,
    description: 'Configure Microsoft authentication for your users',
    setupUrl: 'https://portal.azure.com/',
  },
  {
    id: 'discord',
    name: 'Discord OAuth',
    icon: <Discord className="w-6 h-6" />,
    description: 'Configure Discord authentication for your users',
    setupUrl: 'https://discord.com/developers/applications',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn OAuth',
    icon: <LinkedIn className="w-6 h-6 text-[#0A66C2] dark:text-[#0A66C2]" />,
    description: 'Configure LinkedIn authentication for your users',
    setupUrl: 'https://www.linkedin.com/developers/apps',
  },
  {
    id: 'facebook',
    name: 'Facebook OAuth',
    icon: <Facebook className="w-6 h-6" />,
    description: 'Configure Facebook authentication for your users',
    setupUrl: 'https://developers.facebook.com/apps',
  },
];
