import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Database,
  UserRoundCog,
  HardDrive,
  PanelLeftOpen,
  PanelRightOpen,
  BookOpen,
  ExternalLink,
  RotateCw,
  Sparkles,
  Code2,
  ChartLine,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { Button } from '@/components/radix/Button';
import { ScrollArea } from '@/components/radix/ScrollArea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  onLogout: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavigationProps {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navigation: NavigationProps[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Authentications', href: '/dashboard/authentication', icon: UserRoundCog },
  { name: 'Database', href: '/dashboard/database', icon: Database },
  { name: 'Storage', href: '/dashboard/storage', icon: HardDrive },
  { name: 'Functions', href: '/dashboard/functions', icon: Code2 },
  { name: 'AI', href: '/dashboard/ai', icon: Sparkles },
  // { name: 'Audit', href: '/dashboard/logs', icon: Logs },
  { name: 'Logs', href: '/dashboard/logs', icon: ChartLine },
];

const bottomNavigation = [
  {
    name: 'Documentation',
    href: 'https://docs.insforge.dev',
    icon: BookOpen,
    external: true,
  },
];

export default function AppSidebar({
  onLogout: _onLogout,
  isCollapsed,
  onToggleCollapse,
  ...props
}: AppSidebarProps) {
  const location = useLocation();
  const { hasCompletedOnboarding } = useMcpUsage();

  // Add reinstall navigation item when onboarding is completed
  const dynamicNavigation = hasCompletedOnboarding
    ? [
        ...navigation,
        {
          name: 'Reinstall',
          href: '/dashboard/onboard',
          icon: RotateCw,
        },
      ]
    : [
        {
          name: 'Get Started',
          href: '/dashboard/onboard',
          icon: Link2,
        },
        ...navigation,
      ];

  const NavItem = ({ item, onClick }: { item: NavigationProps; onClick?: () => void }) => {
    const isActive = location.pathname === item.href.split('?')[0];

    const buttonContent = (
      <Button
        variant={isActive ? 'default' : 'ghost'}
        className={cn(
          'w-full h-12 relative transition-all duration-200 ease-in-out',
          isActive
            ? 'bg-zinc-950 dark:bg-emerald-300 text-white dark:text-black'
            : 'hover:bg-zinc-100 dark:hover:bg-neutral-600 text-black dark:text-white'
        )}
        onClick={onClick}
      >
        <div className="absolute left-3.5 h-5 w-5">
          <item.icon className="h-5 w-5" />
        </div>
        {!isCollapsed && (
          <span className="absolute left-11.5 font-medium truncate">{item.name}</span>
        )}
      </Button>
    );

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link to={item.href} className="block">
              {buttonContent}
            </Link>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right">
              <p>{item.name}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <aside
      {...props}
      className={cn(
        'fixed left-0 z-40 bg-white dark:bg-neutral-800 border-r border-gray-200 dark:border-neutral-700 flex flex-col transition-all duration-300 ease-in-out',
        'top-16 bottom-0',
        isCollapsed ? 'w-18' : 'w-60',
        props.className
      )}
    >
      {/* Navigation */}
      <ScrollArea className="flex-1 pl-3 pr-[11px] py-4">
        <nav className="space-y-2">
          {dynamicNavigation.map((item) => (
            <NavItem key={item.name} item={item} />
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom section */}
      <div className="p-3 pr-[11px] space-y-6 overflow-hidden">
        {/* Bottom navigation items */}
        {bottomNavigation.map((item) => (
          <div key={item.name}>
            <Button
              variant="ghost"
              className="w-full h-12 relative transition-all duration-200 ease-in-out border border-gray-200 dark:border-neutral-700 rounded-md hover:bg-zinc-100 dark:hover:bg-neutral-600 text-black dark:text-white"
              onClick={() => window.open(item.href, '_blank')}
            >
              <div className="absolute left-3.5 h-5 w-5">
                <item.icon className="h-5 w-5" />
              </div>
              {!isCollapsed && (
                <>
                  <span className="absolute left-11.5 font-medium truncate">{item.name}</span>
                  {item.external && (
                    <ExternalLink className="absolute left-46.5 h-4 w-4 text-zinc-400" />
                  )}
                </>
              )}
            </Button>
          </div>
        ))}

        {/* Collapse button - only visible on 2xl screens */}
        <div className="hidden 2xl:block">
          <Button
            variant="ghost"
            className="w-full h-12 relative transition-all duration-200 ease-in-out hover:bg-zinc-100 dark:hover:bg-neutral-600 text-black dark:text-white"
            onClick={onToggleCollapse}
          >
            <div className="absolute left-3.5 h-5 w-5">
              {isCollapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelRightOpen className="h-5 w-5" />
              )}
            </div>
            {!isCollapsed && <span className="absolute left-11.5 font-medium">Collapse</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
