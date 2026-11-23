import { NavLink } from 'react-router-dom';
import { Blocks } from 'lucide-react';

export function IntegrationsSidebar() {
  return (
    <div className="flex w-64 flex-col border-r border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))]">
      <div className="flex h-14 items-center justify-between border-b border-[var(--alpha-8)] px-4">
        <h2 className="text-sm font-medium text-foreground">Integrations</h2>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        <NavLink
          to="/dashboard/integrations"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-alpha-4 text-foreground font-medium'
                : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
            }`
          }
        >
          <Blocks className="h-4 w-4" />
          Overview
        </NavLink>
      </nav>
    </div>
  );
}
