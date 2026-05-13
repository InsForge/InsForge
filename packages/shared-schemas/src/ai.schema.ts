import { z } from 'zod';

// OpenRouter can add modalities over time, so keep this intentionally open-ended.
export const modalitySchema = z.string().min(1);

// Export types
export type ModalitySchema = z.infer<typeof modalitySchema>;
