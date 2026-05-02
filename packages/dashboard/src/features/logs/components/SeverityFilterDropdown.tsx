import { Check, ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@insforge/ui';
import { cn } from '#lib/utils/utils';
import { SEVERITY_CONFIG, type SeverityType } from '#features/logs/helpers';

const ORDERED_SEVERITIES: SeverityType[] = ['error', 'warning', 'informational'];
const SEVERITY_DOT_COLORS: Record<SeverityType, string> = {
  error: '#F2555A',
  warning: '#F2BB4B',
  informational: '#A3A3A3',
};

interface SeverityFilterDropdownProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function SeverityFilterDropdown({ value, onChange }: SeverityFilterDropdownProps) {
  const toggleSeverity = (severity: SeverityType) => {
    const nextValues = value.includes(severity)
      ? value.filter((current) => current !== severity)
      : [...value, severity];

    onChange(ORDERED_SEVERITIES.filter((current) => nextValues.includes(current)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 min-w-25 justify-between gap-1 border border-[var(--alpha-8)] bg-[rgb(var(--card))] px-3 text-[13px] font-medium text-[rgb(var(--foreground))]"
        >
          <span className="truncate">Severity</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="flex w-56 flex-col gap-1.5 border-[var(--alpha-8)] bg-toast p-1.5 shadow-[0_4px_4px_rgba(0,0,0,0.08)]"
      >
        {ORDERED_SEVERITIES.map((severity) => {
          const config = SEVERITY_CONFIG[severity];
          const isSelected = value.includes(severity);

          return (
            <DropdownMenuItem
              key={severity}
              onSelect={(event) => {
                event.preventDefault();
                toggleSeverity(severity);
              }}
              className="px-1.5 py-1.5 [&_svg]:size-4"
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-[2px]',
                    isSelected
                      ? 'bg-primary text-[rgb(var(--semantic-1))]'
                      : 'border border-[var(--alpha-12)] bg-[var(--alpha-4)] text-transparent'
                  )}
                >
                  <Check className="size-4" />
                </div>

                <div className="flex items-center">
                  <span className="flex h-5 w-5 items-center justify-center">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: SEVERITY_DOT_COLORS[severity] }}
                    />
                  </span>
                  <span className="text-sm font-medium leading-5 text-foreground">
                    {config.label}
                  </span>
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
