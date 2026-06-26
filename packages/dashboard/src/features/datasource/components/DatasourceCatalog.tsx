import { CONNECTORS } from '#features/datasource/connectors';
import { ConnectorCard } from './ConnectorCard';

export function DatasourceCatalog({ query = '' }: { query?: string }) {
  const q = query.toLowerCase();
  const list = CONNECTORS.filter(
    (c) => c.name.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q)
  );

  if (list.length === 0) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        No data sources match your search.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((c) => (
        <ConnectorCard key={c.id} connector={c} />
      ))}
    </div>
  );
}
