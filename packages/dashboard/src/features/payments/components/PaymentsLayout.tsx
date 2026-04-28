import { Outlet } from 'react-router-dom';
import { PaymentsSidebar } from './PaymentsSidebar';

export default function PaymentsLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <PaymentsSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
