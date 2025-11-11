import { ReactNode } from 'react';

interface ErrorCardProps {
  title?: string;
  children: ReactNode;
}

export function ErrorCard({ title = 'Error', children }: ErrorCardProps) {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-red-200 dark:border-red-800 p-6">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg
              className="h-6 w-6 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{title}</h3>
            <div className="mt-2 text-sm text-red-700 dark:text-red-300">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
