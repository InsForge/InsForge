import { Skeleton } from '@insforge/ui';

// Skeleton is a translucent (`bg-card/10`) pulse that derives its visible color
// from whatever surface it sits on. These cells place it on a DS card surface
// (semantic-3 / #242424) so the loading shapes read clearly, matching how the
// dashboard renders skeletons inside cards.
const Card = ({ children, width = 360 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ padding: 16 }}>
    <div
      style={{
        background: '#2a2a2a',
        borderRadius: 8,
        padding: 16,
        width,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {children}
    </div>
  </div>
);

export const StatCard = () => (
  <Card width={320}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Skeleton className="h-12 w-12 rounded" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-28" />
      </div>
    </div>
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-4/5" />
  </Card>
);

export const TableRows = () => (
  <Card width={420}>
    {[0, 1, 2, 3].map((i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton className="h-8 w-8 rounded" />
        <div style={{ flex: 1, display: 'flex', gap: 12 }}>
          <Skeleton className="h-8 flex-1 rounded" />
          <Skeleton className="h-8 w-16 rounded" />
        </div>
      </div>
    ))}
  </Card>
);

export const PageHeader = () => (
  <Card width={420}>
    <Skeleton className="h-8 w-56" />
    <Skeleton className="h-8 w-32 rounded" />
    <Skeleton className="h-8 w-full rounded" />
    <Skeleton className="h-8 w-4/5 rounded" />
  </Card>
);
