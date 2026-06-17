import { useState, useEffect, useRef } from 'react';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle } from '@insforge/ui';
import { adminService } from '#features/login/services/admin-management.service';
import { useAuth } from '#lib/contexts/AuthContext';

interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AccountSettingsDialog({ open, onOpenChange }: AccountSettingsDialogProps) {
  const { user } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Get username from user object - use sub as fallback display name
  const displayName = user?.sub || 'Admin';
  const username = user?.sub || '';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess('');
      setLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      // Use username from the user object
      // For root admin, this will be 'local:admin'
      // For DB admins, this will be their UUID
      await adminService.changePassword({
        username: username,
        oldPassword,
        newPassword,
      });
      if (!isMountedRef.current) {
        return;
      }
      setSuccess('Password changed successfully!');
      timeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onOpenChange(false);
      }, 1500);
    } catch (err: unknown) {
      if (!isMountedRef.current) {
        return;
      }
      const errorResponse = err as {
        response?: {
          data?: {
            error?: string;
            message?: string;
          };
        };
        message?: string;
      };
      setError(
        errorResponse.response?.data?.message ||
          errorResponse.message ||
          'Failed to change password'
      );
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account Settings</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-primary/10 text-primary p-3 rounded text-sm">{success}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">User</label>
            <Input type="text" value={displayName} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground mt-1">
              {username === 'local:admin' ? 'Root Administrator' : 'Admin User'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Current Password</label>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              placeholder="Enter current password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="Enter new password (min 6 characters)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Confirm new password"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
