export interface EnvVarDraft {
  id: string;
  key: string;
  value: string;
}

const createDraftId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `env-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createEnvVarDraft = (input?: Partial<Omit<EnvVarDraft, 'id'>>): EnvVarDraft => ({
  id: createDraftId(),
  key: input?.key ?? '',
  value: input?.value ?? '',
});

export const normalizeEnvVarDrafts = (drafts: EnvVarDraft[]) => {
  return drafts
    .map((draft) => ({
      key: draft.key.trim(),
      value: draft.value.trim(),
    }))
    .filter((draft) => draft.key || draft.value);
};

export const parseDotEnvInput = (input: string) => {
  const lines = input.split(/\r?\n/);
  const drafts: EnvVarDraft[] = [];
  const invalidLineNumbers: number[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = withoutExport.indexOf('=');

    if (separatorIndex <= 0) {
      invalidLineNumbers.push(index + 1);
      return;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    const rawValue = withoutExport.slice(separatorIndex + 1).trim();

    if (!key) {
      invalidLineNumbers.push(index + 1);
      return;
    }

    const value =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")))
        ? rawValue.slice(1, -1)
        : rawValue;

    drafts.push(createEnvVarDraft({ key, value }));
  });

  return {
    drafts,
    invalidLineNumbers,
  };
};
