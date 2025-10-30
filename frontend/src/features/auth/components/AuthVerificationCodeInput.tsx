import { useRef, KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react';

interface AuthVerificationCodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onComplete?: (code: string) => void;
}

/**
 * 6-digit verification code input component
 *
 * Features:
 * - Auto-focus next input on digit entry
 * - Auto-focus previous input on backspace
 * - Paste support for full code
 * - Numeric input only
 * - Auto-submit when complete
 *
 * @component
 * @example
 * ```tsx
 * const [code, setCode] = useState('');
 *
 * <AuthVerificationCodeInput
 *   value={code}
 *   onChange={setCode}
 *   onComplete={(code) => handleVerify(code)}
 * />
 * ```
 */
export function AuthVerificationCodeInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  onComplete,
}: AuthVerificationCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, digit: string) => {
    // Only allow single digits
    if (digit.length > 1) {
      return;
    }

    // Only allow numbers
    if (digit && !/^\d$/.test(digit)) {
      return;
    }

    // Update the value
    const newValue = value.split('');
    newValue[index] = digit;
    const updatedValue = newValue.join('');
    onChange(updatedValue);

    // Auto-focus next input if digit was entered
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Call onComplete if all digits are filled
    if (digit && updatedValue.length === length && onComplete) {
      onComplete(updatedValue);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace') {
      if (!value[index] && index > 0) {
        // If current input is empty, focus previous input
        inputRefs.current[index - 1]?.focus();
      } else {
        // Clear current input
        handleChange(index, '');
      }
    }
    // Handle arrow keys
    else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').trim();

    // Only paste if it's all digits and correct length
    if (/^\d+$/.test(pastedData) && pastedData.length === length) {
      onChange(pastedData);
      // Focus last input
      inputRefs.current[length - 1]?.focus();
      // Auto-submit if complete
      if (onComplete) {
        onComplete(pastedData);
      }
    }
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[index] || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(index, e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          disabled={disabled}
          autoComplete="one-time-code"
          className="w-12 h-14 text-center text-2xl font-semibold border-2 border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-white focus:border-black dark:focus:border-white focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
      ))}
    </div>
  );
}
