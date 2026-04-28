import { Button } from '@insforge/ui';
import { FAKE_PROJECT } from './fixtures';

export function FakeCloudNavbar() {
  const notifyMock = () => {
    console.info('[MOCK] navbar action disabled in mock cloud mode');
  };

  return (
    <header
      className="flex items-center justify-between gap-4 border-b border-semantic-border bg-semantic-0 px-4 py-2"
      data-testid="fake-cloud-navbar"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">InsForge</span>
        <span
          className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-600"
          aria-label="Mock cloud mode indicator"
        >
          MOCK
        </span>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Mock Organization
        </Button>
        <span className="text-xs text-semantic-muted">/</span>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          {FAKE_PROJECT.name}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Upgrade
        </Button>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Contact
        </Button>
        <Button variant="ghost" size="sm" onClick={notifyMock}>
          Mock User
        </Button>
      </div>
    </header>
  );
}
