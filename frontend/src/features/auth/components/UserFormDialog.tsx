import React, { useEffect, useState } from 'react';
import { CircleAlert, Eye, EyeOff, Lock, Mail, User as UserIcon, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
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

const validateEmail = (email: string): string => {
  if (!email.trim()) return 'Email is required';
  try {
    emailSchema.parse(email);
    return '';
  } catch (error) {
    if (error instanceof z.ZodError) return 'Invalid email format';
    return 'Invalid email';
  }
};

const validatePassword = (password: string): string => {
  if (!password.trim()) return 'Password is required';
  return '';
};

interface FieldProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string;
  showError?: boolean;
  children: React.ReactNode;
}

function Field({ id, label, icon, error, showError, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-sm font-medium leading-5 text-muted-foreground"
      >
        {icon}
        {label}
      </label>
      {children}
      <div
        className={cn(
          'flex items-center gap-1 overflow-hidden text-xs text-destructive transition-all duration-150',
          showError && error ? 'max-h-5 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <CircleAlert strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    </div>
  );
}

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const { showToast } = useToast();
  const { refetch, register } = useUsers();

  useEffect(() => {
    if (open) {
      setName(user?.name ?? '');
      setEmail(user?.email ?? '');
      setPassword('');
      setShowPassword(false);
      setSubmitError('');
      setEmailError('');
      setPasswordError('');
      setShowValidation(false);
    }
  }, [user, open]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (showValidation) setEmailError(validateEmail(e.target.value));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (showValidation) setPasswordError(validatePassword(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);
    setEmailError(emailErr);
    setPasswordError(passwordErr);
    setShowValidation(true);

    if (emailErr || passwordErr) return;

    setLoading(true);
    try {
      await register({ name: name.trim() || undefined, email, password });
      void refetch();
      onOpenChange(false);
      showToast('User created successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[440px] p-0">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="flex-row items-center justify-between gap-3">
            <DialogTitle>Create user</DialogTitle>
            <DialogCloseButton
              className="relative right-auto top-auto h-8 w-8 rounded p-1 text-muted-foreground hover:bg-alpha-4 hover:text-foreground"
              disabled={loading}
            >
              <X strokeWidth={1.5} className="size-4" />
              <span className="sr-only">Close</span>
            </DialogCloseButton>
          </DialogHeader>

          <DialogBody className="gap-4 p-5">
            <Field
              id="user-name"
              label="Name"
              icon={<UserIcon strokeWidth={1.5} className="h-4 w-4 text-muted-foreground" />}
            >
              <Input
                id="user-name"
                type="text"
                placeholder="Enter name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </Field>

            <Field
              id="user-email"
              label="Email"
              icon={<Mail strokeWidth={1.5} className="h-4 w-4 text-muted-foreground" />}
              error={emailError}
              showError={showValidation}
            >
              <Input
                id="user-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={handleEmailChange}
                disabled={loading}
                className={cn(showValidation && emailError && 'border-destructive')}
              />
            </Field>

            <Field
              id="user-password"
              label="Password"
              icon={<Lock strokeWidth={1.5} className="h-4 w-4 text-muted-foreground" />}
              error={passwordError}
              showError={showValidation}
            >
              <div className="relative">
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={handlePasswordChange}
                  disabled={loading}
                  className={cn(
                    'pr-9',
                    showValidation && passwordError && 'border-destructive'
                  )}
                />
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff strokeWidth={1.5} className="h-4 w-4" />
                  ) : (
                    <Eye strokeWidth={1.5} className="h-4 w-4" />
                  )}
                </button>
              </div>
            </Field>
          </DialogBody>

          <DialogFooter>
            {submitError && (
              <div className="mr-auto flex min-w-0 flex-1 items-center gap-1.5 text-xs text-destructive">
                <CircleAlert strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{submitError}</span>
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="min-w-20 text-muted-foreground"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="min-w-20">
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default UserFormDialog;
