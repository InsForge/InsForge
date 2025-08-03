import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Database,
  UserRoundCog,
  Activity,
  HardDrive,
  Info,
  PanelLeftOpen,
  PanelRightOpen,
  BookOpen,
  ExternalLink,
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
import { OnboardButton } from '@/components/OnboardButton';

interface AppSidebarProps {
  currentUser: any;
  onLogout: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavigationProps {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: boolean;
}

const navigation: NavigationProps[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Authentications', href: '/dashboard/authentication', icon: UserRoundCog },
  { name: 'Database', href: '/dashboard/database', icon: Database },
  { name: 'Storage', href: '/dashboard/storage', icon: HardDrive },
  //{ name: 'Audit', href: '/dashboard/logs', icon: Logs },
  { name: 'Analytics', href: '/dashboard/analytics', icon: Activity },
  { name: 'Metadata', href: '/dashboard/metadata', icon: Info },
];

const bottomNavigation = [
  {
    name: 'Documentation',
    href: 'https://github.com/InsForge/InsForge',
    icon: BookOpen,
    external: true,
  },
];

export default function AppSidebar({
  currentUser: _currentUser,
  onLogout: _onLogout,
  isCollapsed,
  onToggleCollapse,
}: AppSidebarProps) {
  const location = useLocation();

  const NavItem = ({ item, onClick }: { item: NavigationProps; onClick?: () => void }) => {
    const isActive = location.pathname === item.href;

    const buttonContent = (
      <Button
        variant={isActive ? 'default' : 'ghost'}
        className={cn(
          'relative transition-all duration-200 ease-in-out group',
          isCollapsed ? 'w-12 h-12 p-0 justify-center' : 'w-full h-12 justify-start px-3.5 gap-0',
          !isActive && 'hover:bg-zinc-100 text-black',
          isActive && 'bg-zinc-950 text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400'
        )}
        onClick={onClick}
      >
        <item.icon
          className={cn(
            'transition-all duration-200',
            'h-5 w-5 flex-shrink-0',
            isCollapsed ? '' : 'mr-3'
          )}
        />
        {!isCollapsed && <span className="font-medium truncate">{item.name}</span>}
      </Button>
    );

    if (item.external) {
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">
                {buttonContent}
              </a>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>{item.name}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );
    }

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
      className={cn(
        'fixed left-0 z-40 bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out',
        'top-16 bottom-0',
        isCollapsed ? 'w-[72px]' : 'w-[240px]'
      )}
    >
      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-2">
          {navigation.map((item) => (
            <div key={item.name}>
              <NavItem item={item} />
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom section */}
      <div className="p-3 space-y-6">
        {/* Bottom navigation items */}
        {bottomNavigation.map((item) => (
          <div key={item.name}>
            <Button
              variant="ghost"
              className={cn(
                'relative transition-all duration-200 ease-in-out group border border-gray-200 rounded-md',
                isCollapsed
                  ? 'w-12 h-12 p-0 justify-center'
                  : 'w-full h-12 justify-start px-3.5 gap-0',
                'hover:bg-zinc-100 text-black',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400'
              )}
              onClick={() => window.open(item.href, '_blank')}
            >
              <item.icon
                className={cn(
                  'transition-all duration-200',
                  'h-5 w-5 flex-shrink-0',
                  isCollapsed ? '' : 'mr-3'
                )}
              />
              {!isCollapsed && <span className="font-medium truncate">{item.name}</span>}
              {!isCollapsed && item.external && (
                <ExternalLink className="h-4 w-4 ml-auto text-zinc-400" />
              )}
            </Button>
          </div>
        ))}

        {/* Collapse button */}
        <div>
          <Button
            variant="ghost"
            className={cn(
              'relative transition-all duration-200 ease-in-out hover:bg-zinc-100',
              isCollapsed
                ? 'w-12 h-12 p-0 justify-center'
                : 'w-full h-12 justify-start px-3.5 gap-0'
            )}
            onClick={onToggleCollapse}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4 mr-3" />
            )}
            {!isCollapsed && <span className="font-medium">Collapse</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
