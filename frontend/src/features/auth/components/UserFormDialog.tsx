import React, { useEffect, useState } from 'react';
import { CircleAlert, Lock, Mail, User as UserIcon, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';
import { useToast } from '@/lib/hooks/useToast';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { cn } from '@/lib/utils/utils';
import { emailSchema } from '@insforge/shared-schemas';
import { z } from 'zod';

interface User {
  id?: string;
  email: string;
  password?: string;
  name?: string;
}

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
}

// Validation helpers
const validateEmail = (email: string): string => {
  if (!email.trim()) {
    return 'Cannot leave empty';
  }
  try {
    emailSchema.parse(email);
    return '';
  } catch (error) {
    if (error instanceof z.ZodError) {
      return 'Incorrect format';
    }
    return 'Invalid email';
  }
};

const validatePassword = (password: string): string => {
  if (!password.trim()) {
    return 'Cannot leave empty';
  }
  return '';
};

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Validation states
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const { showToast } = useToast();
  const { refetch, register } = useUsers();

  useEffect(() => {
    if (user) {
      setName(user.name ?? '');
      setEmail(user.email);
      setPassword('');
    } else {
      setName('');
      setEmail('');
      setPassword('');
    }
    setError('');
    setEmailError('');
    setPasswordError('');
    setShowValidation(false);
  }, [user, open]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    // Clear error when user starts typing
    if (emailError && showValidation) {
      const error = validateEmail(e.target.value);
      setEmailError(error);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    // Clear error when user starts typing
    if (passwordError && showValidation) {
      const error = validatePassword(e.target.value);
      setPasswordError(error);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate all fields
    const emailValidationError = validateEmail(email);
    const passwordValidationError = validatePassword(password);

    setEmailError(emailValidationError);
    setPasswordError(passwordValidationError);
    setShowValidation(true);

    if (emailValidationError || passwordValidationError) {
      return;
    }

    setLoading(true);

    try {
      await register({
        name: name.trim() || undefined,
        email,
        password,
      });
      void refetch();
      onOpenChange(false);
      showToast('User created successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[640px] max-w-[640px] p-0">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="flex flex-col"
        >
          <DialogHeader className="gap-0 px-4 py-3">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-medium leading-7 text-foreground">
                  Add User
                </DialogTitle>
              </div>
              <DialogCloseButton
                className="relative right-auto top-auto h-8 w-8 rounded p-1 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground"
                disabled={loading}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DialogCloseButton>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-2 p-4">
            <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-6">
              <label
                htmlFor="user-name"
                className="flex items-center gap-1 py-1.5 text-sm leading-5 text-foreground"
              >
                <span className="inline-flex size-6 items-center justify-center">
                  <UserIcon className="h-[14px] w-[14px] stroke-[1.5] text-muted-foreground" />
                </span>
                <span>Name</span>
              </label>
              <div className="min-w-0">
                <Input
                  id="user-name"
                  type="text"
                  placeholder="Enter name"
                  value={name}
                  onChange={handleNameChange}
                  className="h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]"
                />
              </div>
            </div>

            <div className="flex h-5 items-center">
              <div className="h-px w-full bg-[var(--alpha-8)]" />
            </div>

            <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-6">
              <label
                htmlFor="user-email"
                className="flex items-center gap-1 py-1.5 text-sm leading-5 text-foreground"
              >
                <span className="inline-flex size-6 items-center justify-center">
                  <Mail className="h-[14px] w-[14px] stroke-[1.5] text-muted-foreground" />
                </span>
                <span>Email</span>
              </label>
              <div className="min-w-0">
                <Input
                  id="user-email"
                  type="email"
                  placeholder="Enter email"
                  value={email}
                  onChange={handleEmailChange}
                  className={cn(
                    'h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]',
                    emailError && showValidation && 'border-destructive focus:shadow-none'
                  )}
                />
              </div>
            </div>

            <div className="flex h-5 items-center">
              <div className="h-px w-full bg-[var(--alpha-8)]" />
            </div>

            <div className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-6">
              <label
                htmlFor="user-password"
                className="flex items-center gap-1 py-1.5 text-sm leading-5 text-foreground"
              >
                <span className="inline-flex size-6 items-center justify-center">
                  <Lock className="h-[14px] w-[14px] stroke-[1.5] text-muted-foreground" />
                </span>
                <span>Password</span>
              </label>
              <div className="min-w-0">
                <Input
                  id="user-password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={handlePasswordChange}
                  className={cn(
                    'h-8 rounded bg-[var(--alpha-4)] px-1.5 py-1.5 text-[13px] leading-[18px]',
                    passwordError && showValidation && 'border-destructive focus:shadow-none'
                  )}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-3 px-4 py-4">
            {error && (
              <div className="mr-auto flex min-w-0 flex-1 items-center gap-1 text-sm leading-6 text-muted-foreground">
                <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
                <span className="truncate">{error}</span>
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="h-8 rounded px-2"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || email === '' || password === ''}
              className="h-8 rounded px-2"
            >
              {loading ? 'Add...' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default UserFormDialog;
