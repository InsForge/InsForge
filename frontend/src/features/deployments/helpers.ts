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
      value: draft.value,
    }))
    .filter((draft) => draft.key || draft.value);
};

const stripInlineComment = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '#' && (index === 0 || /\s/.test(value[index - 1] ?? ''))) {
      return value.slice(0, index).replace(/\s+$/, '');
    }
  }

  return value;
};

const parseDotEnvValue = (value: string) => {
  const trimmedStart = value.trimStart();

  if (!trimmedStart) {
    return '';
  }

  const quote = trimmedStart[0];
  if (quote !== '"' && quote !== "'") {
    return stripInlineComment(trimmedStart);
  }

  let isEscaped = false;
  for (let index = 1; index < trimmedStart.length; index += 1) {
    const character = trimmedStart[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === '\\') {
      isEscaped = true;
      continue;
    }

    if (character !== quote) {
      continue;
    }

    const remainder = trimmedStart.slice(index + 1).trim();
    if (remainder && !remainder.startsWith('#')) {
      return trimmedStart;
    }

    return trimmedStart.slice(1, index);
  }

  return trimmedStart;
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

    const withoutExport = line.trimStart().startsWith('export ') ? line.trimStart().slice(7) : line;
    const separatorIndex = withoutExport.indexOf('=');

    if (separatorIndex <= 0) {
      invalidLineNumbers.push(index + 1);
      return;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    const rawValue = withoutExport.slice(separatorIndex + 1);

    if (!key) {
      invalidLineNumbers.push(index + 1);
      return;
    }

    const value = parseDotEnvValue(rawValue);

    drafts.push(createEnvVarDraft({ key, value }));
  });

  return {
    drafts,
    invalidLineNumbers,
  };
};
