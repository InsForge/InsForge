import { ReactElement } from 'react';
import Github from '@/assets/logos/github.svg?react';
import Google from '@/assets/logos/google.svg?react';
import Microsoft from '@/assets/logos/microsoft.svg?react';
import Discord from '@/assets/logos/discord.svg?react';
import LinkedIn from '@/assets/logos/linkedin.svg?react';
import Facebook from '@/assets/logos/facebook.svg?react';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';

export enum AuthTab {
  USERS = 'users',
  AUTH_METHODS = 'auth-methods',
  CONFIGURATION = 'configuration',
}

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
    icon: <Microsoft className="w-6 h-6" />,
    description: 'Configure Microsoft authentication for your users',
    setupUrl: 'https://portal.azure.com/',
  },
  {
    id: 'discord',
    name: 'Discord OAuth',
    icon: <Discord className="w-6 h-6 text-[#5765F2] dark:text-white" />,
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

/**
 * AI prompts for implementing auth components
 */
export const AUTH_IMPLEMENTATION_PROMPT = `
# Add InsForge Authentication to Your Application
The \`@insforge/react\` package provides **complete authentication solution for React applications**. Use deployed auth pages (built-in auth) or custom UI components—works with Vite.
**Scope:** All AI-generated advice or code related to InsForge must follow these guardrails. We don't support other frameworks or libraries.

## Quick start

### Step 1: Create New React Project (Skip if you already have a project)

\`\`\`bash
npm install @insforge/react@latest
\`\`\`

### Step 2: Set Environment Variables

\`\`\`bash .env
VITE_INSFORGE_BASE_URL=https://your-app.region.insforge.app
VITE_INSFORGE_ANON_KEY=your-anon-key-here
\`\`\`

### Step 3: Setup Provider

Wrap your app with \`InsforgeProvider\` in the root:

\`\`\`tsx src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { InsforgeProvider } from '@insforge/react';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InsforgeProvider
      baseUrl={
        import.meta.env.VITE_INSFORGE_BASE_URL || 'https://your-app.region.insforge.app' // Replace with your InsForge backend URL
      }
    >
      <App />
    </InsforgeProvider>
  </StrictMode>
);
\`\`\`

### Step 4: Use Hooks & Components

\`\`\`tsx src/pages/Home.tsx
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton, useUser } from '@insforge/react';

export default function Home() {
  const { user } = useUser();

  return (
    <div>
      <SignedOut>
        <SignInButton />
        <SignUpButton />
      </SignedOut>

      <SignedIn>
        <UserButton />
        <h1>Welcome, \${user?.email}!</h1>
      </SignedIn>
    </div>
  );
}
\`\`\`

## Next Steps

### Hooks

#### \`useAuth()\`

Access authentication state:

\`\`\`tsx
import { useAuth } from '@insforge/react';

function LoginButton() {
  const { isSignedIn, isLoaded } = useAuth();
  
  if (!isLoaded) return <div>Loading...</div>;

  return (
    <div>
      {isSignedIn ? 'Welcome!' : 'Sign In'}
    </div>
  );
}
\`\`\`

**Returns:**

- \`isSignedIn\` - Boolean auth state
- \`isLoaded\` - Boolean loading state

#### \`useUser()\`

Access current user data:

\`\`\`tsx
import { useUser } from '@insforge/react';

function UserProfile() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) return <div>Loading...</div>;
  if (!user) return <div>Not signed in</div>;


  return (
    <div>
      <p>Id: \${user.id}</p>
      <p>Email: \${user.email}</p>
      <p>Name: \${user.name}</p>
      <img src={user.avatarUrl} alt="Avatar" />
    </div>
  );
}
\`\`\`

**Returns:**

- \`user\` - User object with id, email, name, avatarUrl
- \`isLoaded\` - Boolean loading state

`;
