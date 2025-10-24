import CheckedIcon from '@/assets/icons/checked.svg?react';

interface AuthPasswordStrengthIndicatorProps {
  password: string;
}

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
}

const requirements: PasswordRequirement[] = [
  {
    label: 'At least 1 Uppercase letter',
    test: (pwd) => /[A-Z]/.test(pwd),
  },
  {
    label: 'At least 1 Number',
    test: (pwd) => /\d/.test(pwd),
  },
  {
    label: 'Special character (e.g. !?<>@#$%)',
    test: (pwd) => /[!@#$%^&*()_+\-=[\]{};\\|,.<>/?]/.test(pwd),
  },
  {
    label: '8 characters or more',
    test: (pwd) => pwd.length >= 8,
  },
];

/**
 * Validates that a password meets all strength requirements.
 */
export function validatePasswordStrength(password: string): boolean {
  if (!password) {
    return false;
  }
  return requirements.every((req) => req.test(password));
}

/**
 * Visual indicator component showing password strength requirements.
 */
export function AuthPasswordStrengthIndicator({ password }: AuthPasswordStrengthIndicatorProps) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {requirements.map((requirement, index) => {
        const isValid = requirement.test(password);
        return (
          <div key={index} className="flex items-center gap-2">
            {isValid ? (
              <CheckedIcon className="w-6 h-6" />
            ) : (
              <div className="ml-0.5 w-5 h-5 rounded-full border-2 border-neutral-400" />
            )}
            <span className="text-sm text-neutral-600">{requirement.label}</span>
          </div>
        );
      })}
    </div>
  );
}
