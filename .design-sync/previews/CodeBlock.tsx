import { CodeBlock } from '@insforge/ui';

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, maxWidth: 640 }}>
    {children}
  </div>
);

export const InlineSnippet = () => (
  <Stack>
    <CodeBlock code="npx @insforge/sdk init --project insforge-prod" />
  </Stack>
);

export const ProjectUrl = () => (
  <Stack>
    <CodeBlock code="https://api.insforge.dev/v1/projects/238181" />
  </Stack>
);

export const LabeledKey = () => (
  <Stack>
    <CodeBlock
      label="anon key"
      variant="compact"
      code="ins_pk_live_8f2c1d4e9b7a3056c1d8e4f60a92b3c7d5e8f1a204b6c9d0"
    />
  </Stack>
);

export const SqlStatement = () => (
  <Stack>
    <CodeBlock
      label="SQL"
      variant="compact"
      code={`select id, email, created_at
from auth.users
where created_at > now() - interval '7 days'
order by created_at desc;`}
    />
  </Stack>
);
