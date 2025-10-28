import { Loader2 } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { OAuthProvidersSchema } from '@insforge/shared-schemas';
import GoogleIcon from '@/assets/logos/google.svg?react';
import GithubIcon from '@/assets/logos/github.svg?react';
import DiscordIcon from '@/assets/logos/discord.svg?react';
import FacebookIcon from '@/assets/logos/facebook.svg?react';
import LinkedInIcon from '@/assets/logos/linkedin.svg?react';
import MicrosoftIcon from '@/assets/logos/microsoft.svg?react';
import AppleIcon from '@/assets/logos/apple.svg?react';
import XIcon from '@/assets/logos/x.svg?react';
import InstagramIcon from '@/assets/logos/instagram.svg?react';
import TikTokIcon from '@/assets/logos/tiktok.svg?react';
import SpotifyIcon from '@/assets/logos/spotify.svg?react';

interface AuthOAuthProvidersProps {
  providers: OAuthProvidersSchema[];
  onClick: (provider: OAuthProvidersSchema) => void;
  loading?: OAuthProvidersSchema | null;
  disabled?: boolean;
}

const providerConfig: Record<OAuthProvidersSchema, { name: string; icon: React.ReactNode }> = {
  google: {
    name: 'Google',
    icon: <GoogleIcon className="w-6 h-6" />,
  },
  github: {
    name: 'GitHub',
    icon: <GithubIcon className="w-6 h-6" />,
  },
  discord: {
    name: 'Discord',
    icon: <DiscordIcon className="w-6 h-6 text-[#3E4CD7]" />,
  },
  facebook: { name: 'Facebook', icon: <FacebookIcon className="w-6 h-6" /> },
  linkedin: { name: 'LinkedIn', icon: <LinkedInIcon className="w-6 h-6" /> },
  microsoft: { name: 'Microsoft', icon: <MicrosoftIcon className="w-6 h-6" /> },
  apple: { name: 'Apple', icon: <AppleIcon className="w-6 h-6" /> },
  x: { name: 'X', icon: <XIcon className="w-6 h-6" /> },
  instagram: { name: 'Instagram', icon: <InstagramIcon className="w-6 h-6" /> },
  tiktok: { name: 'TikTok', icon: <TikTokIcon className="w-6 h-6" /> },
  spotify: { name: 'Spotify', icon: <SpotifyIcon className="w-6 h-6" /> },
};

export function AuthOAuthProviders({
  providers,
  onClick,
  loading,
  disabled,
}: AuthOAuthProvidersProps) {
  if (providers.length === 0) {
    return null;
  }

  const count = providers.length;

  // Determine display mode based on count
  const getDisplayMode = () => {
    if (count === 1) {
      return 'full';
    }
    if (count === 2 || count === 4) {
      return 'short';
    }
    return 'icon';
  };

  const displayMode = getDisplayMode();

  // Calculate grid column style for each button
  // Grid is always 6 columns, but buttons span different widths based on total count
  const getGridColumnStyle = (index: number): React.CSSProperties => {
    // 1 button: span all 6 columns
    if (count === 1) {
      return { gridColumn: 'span 6' };
    }

    // 2 buttons: each spans 3 columns
    if (count === 2) {
      return { gridColumn: 'span 3' };
    }

    // 3 buttons: each spans 2 columns
    if (count === 3) {
      return { gridColumn: 'span 2 / span 2' };
    }

    // 4 buttons: 2 rows, each button spans 3 columns
    if (count === 4) {
      return { gridColumn: 'span 3' };
    }

    // 5+ buttons: each spans 2 columns, with last row centered if needed
    const totalRows = Math.ceil(count / 3);
    const lastRowStartIndex = (totalRows - 1) * 3;
    const isInLastRow = index >= lastRowStartIndex;

    if (!isInLastRow) {
      // Not in last row, use default span 2
      return { gridColumn: 'span 2 / span 2' };
    }

    // Calculate position in last row (0-based)
    const positionInLastRow = index - lastRowStartIndex;
    const itemsInLastRow = count - lastRowStartIndex;

    if (itemsInLastRow === 1) {
      // Last row has 1 item: center it at columns 3-4 (span 2 in middle)
      return { gridColumn: '3 / 5' };
    } else if (itemsInLastRow === 2) {
      // Last row has 2 items: center them symmetrically
      if (positionInLastRow === 0) {
        return { gridColumn: '2 / 4' }; // First button: cols 2-3
      } else {
        return { gridColumn: '4 / 6' }; // Second button: cols 4-5
      }
    } else {
      // Last row has 3 items: normal span 2
      return { gridColumn: 'span 2 / span 2' };
    }
  };

  return (
    <div className="grid gap-3 grid-cols-6">
      {providers.map((provider, index) => {
        const config = providerConfig[provider];
        const isLoading = loading === provider;

        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            onClick={() => onClick(provider)}
            disabled={disabled || isLoading}
            className="h-11"
            style={getGridColumnStyle(index)}
            aria-label={`Continue with ${config.name}`}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : config.icon}
            {displayMode === 'full' && <span className="ml-2">Continue with {config.name}</span>}
            {displayMode === 'short' && <span className="ml-2">{config.name}</span>}
          </Button>
        );
      })}
    </div>
  );
}
