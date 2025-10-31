import CheckedIcon from '@/assets/icons/checked.svg?react';
import { PublicEmailAuthConfig } from '@insforge/shared-schemas';
import {
  getPasswordRequirements,
  validatePasswordAgainstConfig,
} from '@/lib/utils/password-validation';

interface AuthPasswordStrengthIndicatorProps {
  password: string;
  config: PublicEmailAuthConfig;
}

/**
 * Validates that a password meets all strength requirements.
 * @deprecated Use validatePasswordAgainstConfig from dynamic-password-validation instead
 */
export function validatePasswordStrength(password: string, config: PublicEmailAuthConfig): boolean {
  return validatePasswordAgainstConfig(password, config);
}

/**
 * Visual indicator component showing password strength requirements.
 * Now uses dynamic configuration from email auth settings.
 */
export function AuthPasswordStrengthIndicator({
  password,
  config,
}: AuthPasswordStrengthIndicatorProps) {
  const requirements = getPasswordRequirements(config);

  if (requirements.length === 0) {
    return null;
  }

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
            <span className="text-sm font-normal text-[#525252] dark:text-neutral-400">
              {requirement.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
