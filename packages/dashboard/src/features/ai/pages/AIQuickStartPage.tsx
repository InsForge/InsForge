import { useMemo, useState, type ReactNode } from 'react';
import { Button, CopyButton, Tab, Tabs } from '@insforge/ui';
import { CodeEditor } from '#components';
import { useOpenRouterKey } from '#features/ai/hooks/useOpenRouterKey';
import { cn } from '#lib/utils/utils';
import {
  PROMPT_CARD_COPY,
  QUICK_START_COPY,
  QUICK_START_MODES,
  getQuickStartPrompt,
  getQuickStartScript,
  type QuickStartMode,
} from '#features/ai/constants';

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
    <div className="w-full rounded border border-[var(--border)] bg-white py-2 dark:bg-[#1e1e1e]">
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
    <div className="w-full rounded border border-[var(--border)] bg-white py-2 dark:bg-[#1e1e1e]">
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
    <div className="relative w-full rounded border border-[var(--border)] bg-white dark:bg-[#1e1e1e]">
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
  const copy = QUICK_START_COPY[mode];
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
      description: copy.description,
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
          code: getQuickStartScript(mode, copy.model),
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
