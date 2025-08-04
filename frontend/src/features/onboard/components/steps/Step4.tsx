import { CodeBlock } from '@/components/CodeBlock';

export function Step4() {
  return (
    <div className="space-y-6 bg-white py-8 px-6 rounded-xl border border-border-gray">
      <div>
        <p className="text-zinc-950 text-sm mb-4">
          Whenever you start a new chat session, init your AI agents with the InsForge init prompt:
        </p>
      </div>

      <CodeBlock code="Learn how to use InsForge" className="bg-slate-50" />

      <div>
        <p className="text-zinc-950 text-sm">Then you can start building!</p>
      </div>
    </div>
  );
}
