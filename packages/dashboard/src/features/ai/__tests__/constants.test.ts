import { describe, expect, it } from 'vitest';
import {
  QUICK_START_MODES,
  PROMPT_CARD_COPY,
  QUICK_START_COPY,
  getQuickStartScript,
  getQuickStartPrompt,
  type QuickStartMode,
} from '#features/ai/constants';

describe('AI Quick Start constants', () => {
  it('includes embeddings in QUICK_START_MODES', () => {
    const modeValues = QUICK_START_MODES.map((mode) => mode.value);
    expect(modeValues).toContain('embeddings');

    const embeddingsMode = QUICK_START_MODES.find((mode) => mode.value === 'embeddings');
    expect(embeddingsMode?.label).toBe('Embeddings');
  });

  it('has PROMPT_CARD_COPY for embeddings', () => {
    expect(PROMPT_CARD_COPY.embeddings).toBeDefined();
    expect(PROMPT_CARD_COPY.embeddings).toContain('embeddings');
  });

  it('has QUICK_START_COPY for embeddings with expected fields', () => {
    const copy = QUICK_START_COPY.embeddings;
    expect(copy).toBeDefined();
    expect(copy.projectName).toBe('ai-embeddings-demo');
    expect(copy.model).toContain('embedding');
    expect(copy.installCommand).toContain('openai');
  });

  it('getQuickStartScript generates embeddings.create code for embeddings mode', () => {
    const script = getQuickStartScript('embeddings', 'openai/text-embedding-3-small');
    expect(script).toContain('openai.embeddings.create');
    expect(script).toContain('openai/text-embedding-3-small');
    expect(script).not.toContain('chat.completions');
  });

  it('getQuickStartScript generates chat.completions code for text mode', () => {
    const script = getQuickStartScript('text', 'openai/gpt-5.5');
    expect(script).toContain('chat.completions.create');
    expect(script).not.toContain('embeddings.create');
  });

  it('getQuickStartPrompt names the same SDK instance as the generated script', () => {
    const prompt = getQuickStartPrompt('embeddings');
    expect(prompt).toContain('embedding');
    expect(prompt).toContain('openai.embeddings.create');
    expect(prompt).toContain('OPENROUTER_API_KEY');
    // The generated script instantiates the SDK as `openai`, so the prompt must
    // not tell the agent to call `client.embeddings.create()`.
    expect(prompt).not.toContain('client.embeddings.create');
  });

  it('all modes have consistent QUICK_START_COPY entries', () => {
    const modes: QuickStartMode[] = ['text', 'image', 'video', 'embeddings'];
    for (const mode of modes) {
      const copy = QUICK_START_COPY[mode];
      expect(copy.projectName).toBeTruthy();
      expect(copy.description).toBeTruthy();
      expect(copy.model).toBeTruthy();
      expect(copy.installCommand).toBeTruthy();
    }
  });
});
