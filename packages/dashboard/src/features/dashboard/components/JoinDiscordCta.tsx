import DiscordIcon from '#assets/logos/discord.svg?react';
import { cn } from '#lib/utils/utils';

interface JoinDiscordCtaProps {
  className?: string;
}

export function JoinDiscordCta({ className }: JoinDiscordCtaProps) {
  return (
    <p
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0 text-sm leading-6 text-muted-foreground',
        className
      )}
    >
      <span>Need help? Join our</span>
      <a
        href="https://discord.gg/DvBtaEc9Jz"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[#818cf8] transition-colors hover:text-[#99a3ff]"
      >
        <DiscordIcon className="size-5" />
        <span>Discord</span>
      </a>
    </p>
  );
}
