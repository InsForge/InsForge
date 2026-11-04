# InsForge Zeabur Template

The previously linked InsForge Zeabur one-click template is no longer available.
This repository has no verified public template URL. The YAML remains available
for maintainers to deploy and test through the Zeabur CLI until a new template
is published and verified.

## CLI Authentication

```bash
npx zeabur@latest auth login
npx zeabur@latest auth logout
```

## Deploy from YAML

Run this command from `deploy/zeabur`:

```bash
npx zeabur@latest template deploy -f template.yml
```

## Restore the one-click button

Publish the tested YAML from the maintainer's Zeabur account. Verify the new
template URL and a deployment before adding the button back to the root README.
Use the code from that URL for subsequent template updates; the old template
code is no longer available.

## Documentation

- Zeabur template format: https://zeabur.com/docs/en-US/template/template-format
- Zeabur template maintenance: https://zeabur.com/docs/en-US/template/maintain-template
