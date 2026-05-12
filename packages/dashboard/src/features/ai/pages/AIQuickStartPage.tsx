import { useMemo, useState, type ReactNode } from 'react';
import { Button, CopyButton, Tab, Tabs } from '@insforge/ui';
import { CodeEditor } from '#components';
import { useOpenRouterKey } from '#features/ai/hooks/useOpenRouterKey';
import { cn } from '#lib/utils/utils';

type QuickStartMode = 'text' | 'image' | 'video';

interface QuickStartStep {
  id: number;
  title: string;
  description: string;
  blocks: CodeBlockProps[];
  action?: {
    label: string;
  };
  note?: ReactNode;
}

interface CodeBlockProps {
  code: string;
  copyText?: string;
  badge?: string;
  kind: 'shell' | 'env' | 'javascript';
}

const QUICK_START_MODES: { value: QuickStartMode; label: string }[] = [
  { value: 'text', label: 'Text Generation' },
  { value: 'image', label: 'Image Generation' },
  { value: 'video', label: 'Video Generation' },
];

const PROMPT_CARD_COPY: Record<QuickStartMode, string> = {
  text: 'Copy this prompt for your agent to generate text through the OpenRouter model gateway.',
  image: 'Copy this prompt for your agent to generate images through the OpenRouter model gateway.',
  video: 'Copy this prompt for your agent to generate videos through the OpenRouter model gateway.',
};

const MODE_COPY: Record<
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

function getScript(mode: QuickStartMode, model: string) {
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

function getQuickStartPrompt(mode: QuickStartMode) {
  const copy = MODE_COPY[mode];
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

function ShellLine({ line }: { line: string }) {
  const tokens = line.split(/(\s+|&&)/g);

  return (
    <span>
      {tokens.map((token, index) => {
        if (token === '&&') {
          return (
            <span key={index} className="text-[#d7ba7d]">
              {token}
            </span>
          );
        }

        if (/^\s+$/.test(token)) {
          return token;
        }

        const isCommand = index === 0 || tokens[index - 2] === '&&';

        return (
          <span key={index} className={isCommand ? 'text-[#4fc1ff]' : 'text-[#ce9178]'}>
            {token}
          </span>
        );
      })}
    </span>
  );
}

function ShellCodeBlock({ code, copyText, badge }: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div className="w-full rounded border border-[var(--border)] bg-[rgb(var(--semantic-0))] py-2">
      <div className="flex items-start gap-3 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          {badge && (
            <div className="mb-3 inline-flex rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
              {badge}
            </div>
          )}
          <div className="flex min-w-0 gap-3 px-1 font-mono text-sm leading-5 text-foreground">
            <span className="shrink-0 text-muted-foreground">$</span>
            <pre className="min-w-0 flex-1 overflow-hidden whitespace-pre-wrap break-words">
              {lines.map((line, index) => (
                <span key={index}>
                  <ShellLine line={line} />
                  {index < lines.length - 1 ? '\n' : null}
                </span>
              ))}
            </pre>
          </div>
        </div>
        <CopyButton
          text={copyText ?? code}
          showText={false}
          copyText="Copy code"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        />
      </div>
    </div>
  );
}

function EnvLine({ line }: { line: string }) {
  const separatorIndex = line.indexOf('=');

  if (separatorIndex === -1) {
    return <span className="text-foreground">{line}</span>;
  }

  const key = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);

  return (
    <>
      <span className="text-[#9cdcfe]">{key}</span>
      <span className="text-[#d7ba7d]">=</span>
      <span className="text-[#ce9178]">{value}</span>
    </>
  );
}

function EnvCodeBlock({ code, copyText, badge }: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div className="w-full rounded border border-[var(--border)] bg-[#1e1e1e] py-2">
      <div className="flex items-start gap-3 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          {badge && (
            <div className="mb-3 inline-flex rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
              {badge}
            </div>
          )}
          <pre className="min-w-0 overflow-hidden whitespace-pre-wrap break-words px-1 font-mono text-sm leading-5">
            {lines.map((line, index) => (
              <span key={index}>
                <EnvLine line={line} />
                {index < lines.length - 1 ? '\n' : null}
              </span>
            ))}
          </pre>
        </div>
        <CopyButton
          text={copyText ?? code}
          showText={false}
          copyText="Copy code"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        />
      </div>
    </div>
  );
}

function JavaScriptCodeBlock({ code, copyText, badge }: CodeBlockProps) {
  const lineCount = code.split('\n').length;
  const editorHeight = Math.max(44, lineCount * 20 + (badge ? 54 : 28));

  return (
    <div className="relative w-full rounded border border-[var(--border)] bg-[#1e1e1e]">
      {badge && (
        <div className="absolute left-4 top-3 z-10 inline-flex rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
          {badge}
        </div>
      )}
      <CopyButton
        text={copyText ?? code}
        showText={false}
        copyText="Copy code"
        className="absolute right-3 top-3 z-10 text-muted-foreground hover:text-foreground"
      />
      <div style={{ height: editorHeight }}>
        <CodeEditor
          code={code}
          editable={false}
          language="javascript"
          basicSetup={undefined}
          className={cn('overflow-hidden pr-10 text-sm', badge && 'pt-8')}
        />
      </div>
    </div>
  );
}

function CodeBlock(props: CodeBlockProps) {
  if (props.kind === 'shell') {
    return <ShellCodeBlock {...props} />;
  }

  if (props.kind === 'env') {
    return <EnvCodeBlock {...props} />;
  }

  return <JavaScriptCodeBlock {...props} />;
}

function StepItem({ step, isLast }: { step: QuickStartStep; isLast: boolean }) {
  return (
    <div className="flex w-full items-start gap-3">
      <div className="flex self-stretch flex-col items-center">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--alpha-16)] bg-toast text-sm leading-5 text-foreground">
          {step.id}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--alpha-16)]" />}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3 pl-1', !isLast && 'pb-10')}>
        <div className="flex flex-col">
          <h2 className="text-base font-medium leading-7 text-foreground">{step.title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{step.description}</p>
        </div>
        {step.action && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 w-fit rounded border-[var(--alpha-8)] bg-card px-2.5 text-sm font-medium text-foreground hover:bg-[var(--alpha-4)]"
          >
            {step.action.label}
          </Button>
        )}
        <div className="flex w-full flex-col gap-2">
          {step.blocks.map((block, index) => (
            <CodeBlock key={index} {...block} />
          ))}
        </div>
        {step.note}
      </div>
    </div>
  );
}

export default function AIQuickStartPage() {
  const [mode, setMode] = useState<QuickStartMode>('text');
  const { data: openRouterKey, isLoading: isOpenRouterKeyLoading } = useOpenRouterKey();
  const copy = MODE_COPY[mode];
  const quickStartPrompt = useMemo(() => getQuickStartPrompt(mode), [mode]);
  const displayedOpenRouterKey = isOpenRouterKeyLoading
    ? 'Loading...'
    : openRouterKey?.maskedKey || '<YOUR_OPENROUTER_API_KEY>';
  const copiedOpenRouterKey = openRouterKey?.apiKey || '';
  const displayedEnvLine = `OPENROUTER_API_KEY=${displayedOpenRouterKey}`;
  const copiedEnvLine = copiedOpenRouterKey
    ? `OPENROUTER_API_KEY=${copiedOpenRouterKey}`
    : displayedEnvLine;

  const steps: QuickStartStep[] = [
    {
      id: 1,
      title: 'Set Up Your Project',
      description: 'Create a new directory and initialize a Node.js project.',
      blocks: [
        {
          code: `mkdir ${copy.projectName} && cd ${copy.projectName}\nnpm init -y`,
          kind: 'shell',
        },
      ],
    },
    {
      id: 2,
      title: 'Install Dependencies',
      description: 'Install the OpenAI SDK and development dependencies.',
      blocks: [
        {
          code: copy.installCommand,
          kind: 'shell',
        },
      ],
    },
    {
      id: 3,
      title: 'Set Up Your API Key',
      description: 'Add your OpenRouter API key to a .env.local file.',
      blocks: [
        {
          badge: '.env.local',
          code: displayedEnvLine,
          copyText: copiedEnvLine,
          kind: 'env',
        },
      ],
      note: (
        <p className="text-sm leading-6 text-muted-foreground">
          Keep this key private and never commit it to source control.
        </p>
      ),
    },
    {
      id: 4,
      title: 'Create and Run Your Script',
      description: 'Save this script as index.ts and run it with tsx.',
      blocks: [
        {
          badge: 'index.ts',
          code: getScript(mode, copy.model),
          kind: 'javascript',
        },
      ],
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-6 px-10 pb-12 pt-10">
        <h1 className="text-2xl font-medium leading-8 text-foreground">Quick Start</h1>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as QuickStartMode)}
          className="h-8 w-full"
        >
          {QUICK_START_MODES.map((item) => (
            <Tab key={item.value} value={item.value} className="h-8 flex-1">
              {item.label}
            </Tab>
          ))}
        </Tabs>

        <section className="rounded border border-[var(--alpha-8)] bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm leading-6 text-muted-foreground">{PROMPT_CARD_COPY[mode]}</p>
            <CopyButton
              text={quickStartPrompt}
              copyText="Copy Prompt"
              copiedText="Copied"
              className="h-8 shrink-0 rounded bg-primary px-2 text-sm font-medium text-[rgb(var(--inverse))] hover:bg-primary/90"
            />
          </div>
        </section>

        <section className="flex flex-col">
          {steps.map((step, index) => (
            <StepItem key={step.id} step={step} isLast={index === steps.length - 1} />
          ))}
        </section>
      </div>
    </div>
  );
}
