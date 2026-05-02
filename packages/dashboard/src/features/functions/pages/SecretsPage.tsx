import { useRef, useState } from 'react';
import { Button, ConfirmDialog, Input } from '@insforge/ui';
import { Skeleton, TableHeader } from '#components';
import { SecretRow } from '#features/functions/components/SecretRow';
import SecretEmptyState from '#features/functions/components/SecretEmptyState';
import { useSecrets } from '#features/functions/hooks/useSecrets';
import { parseEnvAssignment } from '#features/functions/utils/secretPaste';
import { useSmartPaste } from '#lib/hooks/useSmartPaste';

export default function SecretsPage() {
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const valueInputRef = useRef<HTMLInputElement>(null);

  const {
    filteredSecrets,
    searchQuery,
    setSearchQuery,
    isLoading,
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

  const handleSmartPaste = useSmartPaste({
    parse: parseEnvAssignment,
    onParsed: ({ key, value }) => {
      setNewSecretKey(key);
      setNewSecretValue(value);
    },
    focusRef: valueInputRef,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Secrets"
        className="min-w-[960px]"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search secrets"
      />

      {/* Scrollable Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1024px] w-4/5 mx-auto pt-10 pb-10">
          {/* Add New Secret Card */}
          <div className="bg-card rounded-lg mb-6">
            <div className="p-3 border-b border-[var(--alpha-8)]">
              <p className="text-sm text-foreground">Add New Secret</p>
            </div>
            <div className="flex gap-6 items-end p-6">
              <div className="flex-1">
                <label className="block text-sm text-foreground mb-1.5">Key</label>
                <Input
                  placeholder="e.g CLIENT_KEY"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value)}
                  onPaste={handleSmartPaste}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-foreground mb-1.5">Value</label>
                <Input
                  placeholder="Enter Value"
                  type="text"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  onPaste={handleSmartPaste}
                  ref={valueInputRef}
                />
              </div>
              <Button
                onClick={() => void handleSaveNewSecret()}
                className="bg-emerald-300 hover:bg-emerald-400 text-black px-3 py-1.5 rounded"
                disabled={!newSecretKey.trim() || !newSecretValue.trim()}
              >
                Save
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="flex flex-col gap-1">
            {/* Table Header */}
            <div className="flex items-center pl-1.5">
              <div className="flex-1 h-8 flex items-center px-2.5">
                <span className="text-sm text-muted-foreground">Name</span>
              </div>
              <div className="flex-[1.5] h-8 flex items-center px-2.5">
                <span className="text-sm text-muted-foreground">Value</span>
              </div>
              <div className="flex-1 h-8 flex items-center px-2.5">
                <span className="text-sm text-muted-foreground">Updated at</span>
              </div>
              <div className="w-12" />
            </div>

            {/* Table Body */}
            {isLoading ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </>
            ) : filteredSecrets.length >= 1 ? (
              <>
                {filteredSecrets.map((secret) => (
                  <SecretRow
                    key={secret.id}
                    secret={secret}
                    onDelete={() => void deleteSecret(secret)}
                  />
                ))}
              </>
            ) : (
              <SecretEmptyState searchQuery={searchQuery} />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
