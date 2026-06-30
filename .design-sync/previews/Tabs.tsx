import { Tabs, Tab } from '@insforge/ui';

const noop = () => {};

export const LogTabs = () => (
  <div style={{ padding: 16 }}>
    <Tabs value="runtime" onValueChange={noop}>
      <Tab value="runtime">Runtime Logs</Tab>
      <Tab value="build">Build Logs</Tab>
    </Tabs>
  </div>
);

export const WithPanel = () => (
  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <Tabs value="data" onValueChange={noop}>
      <Tab value="data">Data</Tab>
      <Tab value="policies">Policies</Tab>
      <Tab value="indexes">Indexes</Tab>
    </Tabs>
    <div style={{ fontSize: 13, color: 'rgb(var(--muted-foreground))' }}>
      Showing 1,284 rows from the <strong>users</strong> table.
    </div>
  </div>
);

export const ThreeTabs = () => (
  <div style={{ padding: 16 }}>
    <Tabs value="overview" onValueChange={noop}>
      <Tab value="overview">Overview</Tab>
      <Tab value="usage">Usage</Tab>
      <Tab value="settings">Settings</Tab>
    </Tabs>
  </div>
);
