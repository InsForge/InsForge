import React, { useState, useEffect } from 'react';
import { Mail, Lock, AlertCircle } from 'lucide-react';
import { Button, Input, Label, Alert, AlertDescription } from '@/components';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/radix/Dialog';
import ErrorIcon from '@/assets/icons/error.svg';
import { useToast } from '@/lib/hooks/useToast';
import { useUsers } from '@/features/auth/hooks/useUsers';
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

  const isEditing = !!user;

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setPassword('');
    } else {
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
      const userData: User = { email };
      if (password) {
        userData.password = password;
      }
      if (isEditing && user?.id) {
        userData.id = user.id;
      }

      await register({
        email: userData.email,
        password: userData.password || '',
        name: userData.name,
      });
      void refetch();
      onOpenChange(false);
      showToast('User created successfully', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create user', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] dark:bg-neutral-800 dark:text-white p-0 gap-0">
        <DialogHeader className="px-6 py-3 border-b border-zinc-200 dark:border-neutral-700">
          <DialogTitle className="h-7">Add User</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="flex flex-col"
        >
          <div className="space-y-6 p-6">
            {/* Email Field */}
            <div className="flex flex-row gap-10 justify-between items-center">
              <div className="flex flex-row gap-2 items-center">
                <Mail className="h-5 w-5 text-neutral-500" />
                <Label htmlFor="user-email" className="text-sm text-zinc-950 dark:text-neutral-50">
                  Email
                </Label>
              </div>
              <div className="flex flex-col space-y-1">
                <Input
                  id="user-email"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={handleEmailChange}
                  className={`w-70 dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${emailError && showValidation ? 'border-red-500 focus:border-red-500' : ''}`}
                  autoFocus={false}
                />
                {emailError && showValidation && (
                  <div className="flex items-center gap-1">
                    <img src={ErrorIcon} alt="Error" className="h-4 w-4" />
                    <p className="text-xs font-medium text-red-600 dark:text-red-500">
                      {emailError}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-row gap-10 justify-between items-center">
              <div className="flex flex-row gap-2 items-center">
                <Lock className="h-5 w-5 text-neutral-500" />
                <Label
                  htmlFor="user-password"
                  className="text-sm text-zinc-950 dark:text-neutral-50"
                >
                  Password
                </Label>
              </div>
              <div className="flex flex-col space-y-1">
                <Input
                  id="user-password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={handlePasswordChange}
                  className={`w-70 dark:bg-neutral-900 dark:placeholder:text-neutral-400 dark:border-neutral-700 dark:text-white ${passwordError && showValidation ? 'border-red-500 focus:border-red-500' : ''}`}
                />
                {passwordError && showValidation && (
                  <div className="flex items-center gap-1">
                    <img src={ErrorIcon} alt="Error" className="h-4 w-4" />
                    <p className="text-xs font-medium text-red-600 dark:text-red-500">
                      {passwordError}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="mx-6 mb-6 shrink-0">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}
          </div>
          {/* Footer Buttons */}
          <DialogFooter className="p-6 border-t border-zinc-200 dark:border-neutral-700">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="h-9 w-30 px-3 py-2 dark:bg-neutral-600 dark:border-transparent dark:text-white dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || email === '' || password === ''}
              className="h-9 w-30 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-white disabled:opacity-50 disabled:cursor-not-allowed dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400"
            >
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default UserFormDialog;
