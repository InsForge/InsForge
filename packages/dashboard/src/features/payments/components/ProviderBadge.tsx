
export function ProviderBadge({ provider }: { provider: string }) {
  if (provider === 'Razorpay') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-[var(--alpha-8)] text-[#3395FF]">
        Razorpay
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-[var(--alpha-8)] text-[#635BFF]">
      Stripe
    </span>
  );
}
