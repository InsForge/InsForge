import { Pagination } from '@insforge/ui';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, minWidth: 720 }}>{children}</div>
);

export const MidRange = () => (
  <Frame>
    <Pagination
      currentPage={3}
      totalPages={10}
      totalRecords={487}
      pageSize={50}
      recordLabel="users"
      onPageChange={() => {}}
    />
  </Frame>
);

export const FirstPage = () => (
  <Frame>
    <Pagination
      currentPage={1}
      totalPages={4}
      totalRecords={183}
      pageSize={50}
      recordLabel="customers"
      onPageChange={() => {}}
    />
  </Frame>
);

export const WithPageSize = () => (
  <Frame>
    <Pagination
      currentPage={2}
      totalPages={12}
      totalRecords={594}
      pageSize={50}
      recordLabel="transactions"
      pageSizeOptions={[25, 50, 100]}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
    />
  </Frame>
);
