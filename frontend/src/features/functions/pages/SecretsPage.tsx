import { useState } from 'react';
import { Button, Input, Skeleton, SearchInput, ConfirmDialog } from '@/components';
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
    isLoading: loading,
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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        {/* Header */}
        <p className="h-7 text-xl text-zinc-950 dark:text-white">Secrets</p>

        {/* Add New Secret Portal */}
        <div className="bg-white dark:bg-[#333333] rounded-[8px]">
          <div className="p-6 border-b border-gray-200 dark:border-neutral-700">
            <p className="text-base text-zinc-950 dark:text-white">Add New Secret</p>
          </div>
          <div className="p-6 flex gap-6 items-end">
            <div className="flex-1">
              <label className="block text-sm text-zinc-950 dark:text-neutral-50 mb-2">Key</label>
              <Input
                placeholder="e.g CLIENT_KEY"
                value={newSecretKey}
                onChange={(e) => setNewSecretKey(e.target.value)}
                className="shadow-none w-full dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-zinc-950 dark:text-neutral-50 mb-2">Value</label>
              <Input
                placeholder="e.g 1234567890"
                type="text"
                value={newSecretValue}
                onChange={(e) => setNewSecretValue(e.target.value)}
                className="shadow-none w-full dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
              />
            </div>
            <Button
              onClick={() => void handleSaveNewSecret()}
              className="bg-black hover:bg-zinc-800 dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black text-white px-3 py-2 w-20 h-9 rounded"
              disabled={!newSecretKey.trim() || !newSecretValue.trim()}
            >
              Save
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <SearchInput
          placeholder="Search secret"
          value={searchQuery}
          onChange={setSearchQuery}
          className="max-w-70 dark:bg-neutral-900 dark:border-neutral-700"
        />

        {/* Secrets Table */}
        <div className="flex flex-col gap-2">
          {/* Table Header */}
          <div className="grid grid-cols-12 px-3 text-sm text-muted-foreground dark:text-neutral-400">
            <div className="col-span-8 py-1 px-3">Name</div>
            {/* <div className="col-span-5 py-1 px-3">Digest</div> */}
            <div className="col-span-3 py-1 px-3">Updated at</div>
            <div className="col-span-1 py-1 px-3" />
          </div>

          {loading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[8px] cols-span-full" />
              ))}
            </>
          ) : filteredSecrets.length >= 1 ? (
            <>
              {filteredSecrets.map((secret) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  onDelete={() => void deleteSecret(secret)}
                  className="cols-span-full"
                />
              ))}
            </>
          ) : (
            <div className="cols-span-full">
              <SecretEmptyState searchQuery={searchQuery} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
