import { BackendAdvisorSection } from '#features/dashboard/components/advisor/BackendAdvisorSection';

export default function AdvisorsPage() {
  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto flex flex-col gap-8 pt-10 pb-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium text-foreground leading-8">Advisors</h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Scan your PostgreSQL database for security, performance, and health issues.
            </p>
          </div>
          <BackendAdvisorSection />
        </div>
      </div>
    </div>
  );
}
