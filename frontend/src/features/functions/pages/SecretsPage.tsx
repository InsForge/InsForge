import { useState } from 'react';
import { Button, ConfirmDialog, Input } from '@insforge/ui';
import { Skeleton } from '@/components';
import { SecretRow } from '../components/SecretRow';
import SecretEmptyState from '../components/SecretEmptyState';
import { useSecrets } from '@/features/functions/hooks/useSecrets';

export default function SecretsPage() {
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');

  const {
    filteredSecrets,
    searchQuery,
    setSearchQuery,
    isLoading,
    isCreating,
    createSecret,
    deleteSecret,
    confirmDialogProps,
  } = useSecrets();

  const handleSaveNewSecret = async () => {
    const success = await createSecret(newSecretKey, newSecretValue);
    if (success) {
      setNewSecretKey('');
      setNewSecretValue('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      {/* Title */}
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Secrets</h1>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          {/* Add New Secret Card */}
          <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-[var(--alpha-8)] px-6 py-4">
              <p className="text-sm font-medium text-foreground">Add New Secret</p>
              <Button
                onClick={() => void handleSaveNewSecret()}
                disabled={!newSecretKey.trim() || !newSecretValue.trim() || isCreating}
                className="min-w-[80px]"
              >
                {isCreating ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <div className="flex gap-4 p-6">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm text-muted-foreground">Key</label>
                <Input
                  placeholder="e.g CLIENT_KEY"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-sm text-muted-foreground">Value</label>
                <Input
                  placeholder="Enter value"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mb-3 mt-8">
            <Input
              placeholder="Search secrets"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64"
            />
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex h-10 items-center border-b border-border bg-[var(--alpha-4)] px-4">
                <div className="flex-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
                </div>
                <div className="flex-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated at</span>
                </div>
                <div className="w-12" />
              </div>
              {[...Array(4)].map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-14 rounded-none border-b border-border last:border-0"
                />
              ))}
            </div>
          ) : filteredSecrets.length >= 1 ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {/* Column Headers */}
              <div className="flex h-10 items-center border-b border-border bg-[var(--alpha-4)] px-4">
                <div className="flex-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
                </div>
                <div className="flex-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated at</span>
                </div>
                <div className="w-12" />
              </div>
              {filteredSecrets.map((secret, index) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  onDelete={() => void deleteSecret(secret)}
                  isLast={index === filteredSecrets.length - 1}
                />
              ))}
            </div>
          ) : (
            <SecretEmptyState searchQuery={searchQuery} />
          )}
        </div>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
