import OpenAIIcon from '#assets/logos/openai.svg?react';
import ClaudeIcon from '#assets/logos/claude_code.svg?react';
import GeminiIcon from '#assets/logos/gemini.svg?react';

export type CodeTab = 'sdk' | 'python' | 'http';
export type QuickStartMode = 'text' | 'image' | 'video';
export type ModelModalityFilter = string;

export function getOverviewCodeSnippets(modelId: string): Record<CodeTab, string> {
  return {
    sdk: `import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const completion = await openai.chat.completions.create({
  model: '${modelId}',
  messages: [
    {
      role: 'user',
      content: 'Why is the sky blue?',
    },
  ],
});

console.log(completion.choices[0].message);`,
    python: `from openai import OpenAI
import os

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

completion = client.chat.completions.create(
    model="${modelId}",
    messages=[
        {
            "role": "user",
            "content": "Why is the sky blue?",
        }
    ],
)

print(completion.choices[0].message)`,
    http: `curl https://openrouter.ai/api/v1/chat/completions \\
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${modelId}","messages":[{"role":"user","content":"Why is the sky blue?"}]}'`,
  };
}

export const CODE_TAB_LANGUAGE: Record<CodeTab, 'javascript' | 'python'> = {
  sdk: 'javascript',
  python: 'python',
  http: 'python',
};

export const OVERVIEW_QUICK_START_MODELS = [
  {
    id: 'openai/gpt-5.5',
    label: 'OpenAI',
    icon: OpenAIIcon,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Anthropic',
    icon: ClaudeIcon,
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini',
    icon: GeminiIcon,
  },
] as const;

export const MODEL_MODALITY_FILTERS: { id: ModelModalityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'embeddings', label: 'Embed' },
];

export const QUICK_START_MODES: { value: QuickStartMode; label: string }[] = [
  { value: 'text', label: 'Text Generation' },
  { value: 'image', label: 'Image Generation' },
  { value: 'video', label: 'Video Generation' },
];

export const PROMPT_CARD_COPY: Record<QuickStartMode, string> = {
  text: 'Copy this prompt for your agent to generate text through the OpenRouter model gateway.',
  image: 'Copy this prompt for your agent to generate images through the OpenRouter model gateway.',
  video: 'Copy this prompt for your agent to generate videos through the OpenRouter model gateway.',
};

export const QUICK_START_COPY: Record<
  QuickStartMode,
  { projectName: string; description: string; model: string; installCommand: string }
> = {
  text: {
    projectName: 'ai-text-demo',
    description: 'Create a chat completion through OpenRouter with the OpenAI SDK.',
    model: 'openai/gpt-5.5',
    installCommand: 'npm install openai dotenv\nnpm install --save-dev @types/node tsx typescript',
  },
  image: {
    projectName: 'ai-image-demo',
    description: 'Generate an image with an OpenRouter model that supports image output.',
    model: 'google/gemini-2.5-flash-image',
    installCommand: 'npm install openai dotenv\nnpm install --save-dev @types/node tsx typescript',
  },
  video: {
    projectName: 'ai-video-demo',
    description: 'Submit an asynchronous video generation job and poll until it completes.',
    model: 'google/veo-3.1',
    installCommand: 'npm install dotenv\nnpm install --save-dev @types/node tsx typescript',
  },
};

export function getQuickStartScript(mode: QuickStartMode, model: string) {
  if (mode === 'image') {
    return `import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const completion = await openai.chat.completions.create({
  model: '${model}',
  modalities: ['image', 'text'],
  messages: [
    { role: 'user', content: 'Generate a beautiful sunset over mountains.' },
  ],
});

const message = completion.choices[0]?.message;
console.log(message?.content);
console.log(message?.images?.[0]?.image_url?.url);`;
  }

  if (mode === 'video') {
    return `import 'dotenv/config';

const response = await fetch('https://openrouter.ai/api/v1/videos', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.OPENROUTER_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: '${model}',
    prompt: 'A golden retriever playing fetch on a sunny beach.',
  }),
});

const job = await response.json();
console.log('Video job:', job.id);

let result = job;
while (result.status !== 'completed' && result.status !== 'failed') {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const poll = await fetch(\`https://openrouter.ai/api/v1/videos/\${job.id}\`, {
    headers: { Authorization: \`Bearer \${process.env.OPENROUTER_API_KEY}\` },
  });
  result = await poll.json();
  console.log('Status:', result.status);
}

console.log(result);`;
  }

  return `import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const completion = await openai.chat.completions.create({
  model: '${model}',
  messages: [
    { role: 'user', content: 'What is the meaning of life?' },
  ],
});

console.log(completion.choices[0]?.message?.content);`;
}

export function getQuickStartPrompt(mode: QuickStartMode) {
  const copy = QUICK_START_COPY[mode];
  const featureCopy: Record<QuickStartMode, string> = {
    text: 'a text generation feature that sends a user prompt and renders the model response',
    image: 'an image generation feature that sends a user prompt and renders the returned image',
    video:
      'a video generation feature that submits a prompt, polls the job status, and renders the completed video',
  };
  const apiCopy: Record<QuickStartMode, string> = {
    text: 'Use the OpenAI SDK with baseURL set to https://openrouter.ai/api/v1.',
    image:
      "Use the OpenAI SDK with baseURL set to https://openrouter.ai/api/v1 and request modalities ['image', 'text'].",
    video:
      'Use fetch with the OpenRouter video endpoint at https://openrouter.ai/api/v1/videos; do not install or use the OpenAI SDK for video.',
  };

  return [
    `Add ${featureCopy[mode]} using the OpenRouter model gateway.`,
    `Use model ${copy.model}. ${apiCopy[mode]}`,
    'First inspect the existing project and integrate with its current framework, routing, styling, and state patterns. If it is React, Next.js, Vue, Svelte, or another framework, add the feature inside that app instead of creating a separate demo project.',
    'Store the API key in OPENROUTER_API_KEY and read it from environment variables. Do not hard-code secrets or expose server-only keys to the browser; add a backend/API route when the framework needs one.',
    'Install only the dependencies needed for this project, keep the UI minimal and consistent with the existing design, handle loading and error states, and include brief run instructions after implementation.',
  ].join('\n');
}
