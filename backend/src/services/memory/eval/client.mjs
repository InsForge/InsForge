// Minimal HTTP client for POST /api/memory/* — project API key auth only.
// No package dependencies; Node 22+ built-in fetch.

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(
      `missing env: ${missing.join(', ')}. Set INSFORGE_URL and INSFORGE_API_KEY ` +
        `(project API key from GET /api/metadata/api-key on a running stack).`
    );
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

async function call(path, body) {
  const { INSFORGE_URL, INSFORGE_API_KEY } = requireEnv('INSFORGE_URL', 'INSFORGE_API_KEY');
  const res = await fetch(`${INSFORGE_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INSFORGE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object'
        ? (parsed.message ?? parsed.error ?? text.slice(0, 200))
        : text.slice(0, 200);
    throw new Error(`POST ${path} → ${res.status}: ${detail}`);
  }
  // successResponse() returns the payload at the top level (no { data } wrapper).
  return parsed;
}

export const memory = {
  remember: (body) => call('/api/memory/remember', body),
  recall: (body) => call('/api/memory/recall', body),
  index: (scope) => call('/api/memory/index', { scope }),
};
