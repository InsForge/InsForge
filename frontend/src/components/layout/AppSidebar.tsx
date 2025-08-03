import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Database,
  Menu,
  X,
  UserRoundCog,
  Logs,
  HardDrive,
  Bug,
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
  isMobileOpen: boolean;
  onMobileToggle: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Authentications', href: '/dashboard/authentication', icon: UserRoundCog },
  { name: 'Database', href: '/dashboard/database', icon: Database },
  { name: 'Storage', href: '/dashboard/storage', icon: HardDrive },
  { name: 'Logs', href: '/dashboard/logs', icon: Logs },
  { name: 'Metadata', href: '/dashboard/metadata', icon: Info },
];

// Add debug link only when debug mode is enabled
if (import.meta.env.VITE_DEBUG_MODE) {
  navigation.push({ name: 'Debug', href: '/debug', icon: Bug });
}

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
  isMobileOpen,
  onMobileToggle,
  isCollapsed,
  onToggleCollapse,
}: AppSidebarProps) {
  const location = useLocation();

  const NavItem = ({ item, onClick }: { item: any; onClick?: () => void }) => {
    const isActive = location.pathname === item.href;

    const buttonContent = (
      <Button
        variant={isActive ? 'default' : 'ghost'}
        className={cn(
          'relative transition-all duration-200 ease-in-out group',
          // Desktop styles
          'hidden lg:flex',
          isCollapsed ? 'w-12 h-12 p-0 justify-center' : 'w-full h-12 justify-start px-3.5 gap-0',
          // Hover and active states
          !isActive && 'hover:bg-zinc-100 text-black',
          isActive && 'bg-zinc-950 text-white',
          // Focus states
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
              <TooltipContent side="right" className="hidden lg:block">
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
            <TooltipContent side="right" className="hidden lg:block">
              <p>{item.name}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  };

  const MobileNavItem = ({ item }: { item: any }) => {
    const isActive = location.pathname === item.href;

    const buttonContent = (
      <Button
        variant={isActive ? 'default' : 'ghost'}
        className={cn(
          'w-full h-12 justify-start px-3 transition-all duration-200',
          !isActive && 'hover:bg-gray-100 hover:text-gray-900',
          isActive && 'bg-gray-900 text-white'
        )}
        onClick={onMobileToggle}
      >
        <item.icon className="h-5 w-5 mr-3 flex-shrink-0" />
        <span className="font-medium">{item.name}</span>
      </Button>
    );

    if (item.external) {
      return (
        <a href={item.href} target="_blank" rel="noopener noreferrer" className="block lg:hidden">
          {buttonContent}
        </a>
      );
    }

    return (
      <Link to={item.href} className="block lg:hidden">
        {buttonContent}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile menu button */}
      <Button
        variant="outline"
        size="icon"
        className="lg:hidden fixed top-20 left-4 z-40 bg-white shadow-sm"
        onClick={onMobileToggle}
      >
        {isMobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={onMobileToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 z-40 bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out',
          'top-16 bottom-0',
          // Mobile styles
          'w-64 lg:w-auto transform lg:transform-none',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop styles
          'lg:translate-x-0',
          isCollapsed ? 'lg:w-[72px]' : 'lg:w-[240px]'
        )}
      >
        {/* Navigation */}
        <div className={`hidden lg:block py-3 ${isCollapsed ? 'px-1' : 'px-3'}`}>
          {/* Onboard Button - Desktop */}
          <div className="hidden lg:block">
            <OnboardButton isCollapsed={isCollapsed} />
          </div>

          {/* Onboard Button - Mobile */}
          <div className="lg:hidden">
            <OnboardButton isCollapsed={false} onMobileToggle={onMobileToggle} isMobile={true} />
          </div>
        </div>
        <ScrollArea className="flex-1 px-3 lg:px-3 py-4">
          <nav className="space-y-2">
            {/* Regular Navigation - Desktop */}
            {navigation.map((item) => (
              <div key={item.name}>
                <NavItem item={item} />
              </div>
            ))}

            {/* Regular Navigation - Mobile */}
            {navigation.map((item) => (
              <div key={`mobile-${item.name}`} className="lg:hidden">
                <MobileNavItem item={item} />
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
                  // Desktop styles
                  'hidden lg:flex',
                  isCollapsed
                    ? 'w-12 h-12 p-0 justify-center'
                    : 'w-full h-12 justify-start px-3.5 gap-0',
                  // Hover and active states
                  'hover:bg-zinc-100 text-black',
                  // Focus states
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
              <div className="lg:hidden">
                <MobileNavItem item={item} />
              </div>
            </div>
          ))}

          {/* Collapse button - Desktop only */}
          <div className="hidden lg:block">
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
    </>
  );
}
