import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#components';
import { Button, Input } from '@insforge/ui';
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
            await adminService.changePassword({ oldPassword, newPassword });
            setSuccess('Password changed successfully!');
            setTimeout(() => {
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');
                onOpenChange(false);
            }, 1500);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to change password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Account Settings</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-50 text-green-600 p-3 rounded text-sm">
                            {success}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Username
                        </label>
                        <Input
                            type="text"
                            value={user?.username || ''}
                            disabled
                            className="bg-gray-100"
                        />
                        <p className="text-xs text-gray-500 mt-1">Username cannot be changed</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Current Password
                        </label>
                        <Input
                            type="password"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            required
                            placeholder="Enter current password"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            New Password
                        </label>
                        <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            placeholder="Enter new password (min 6 characters)"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Confirm New Password
                        </label>
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
                        <Button
                            type="submit"
                            disabled={loading}
                            className="flex-1"
                        >
                            {loading ? 'Updating...' : 'Update Password'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}