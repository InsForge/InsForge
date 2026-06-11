# @insforge/dashboard

The shared React administration dashboard interface for the **InsForge** Backend-as-a-Service (BaaS) platform.

This package is the single source of truth for the project administration interface, shared and consumed by:
1. The local self-hosting app in `/frontend` of this repository.
2. The enterprise `insforge-cloud` cloud-hosted dashboard.

---

## Key Feature Modules

The dashboard is organized into focused React feature modules:

* **Database Explorer:** Interactive table schema designer, live spreadsheet-style records editor powered by `react-data-grid`, foreign key helper, and a SQL Editor console.
* **Authentication:** User profile table management, signup/login status controls, and third-party OAuth provider configurations.
* **Storage Browser:** Multi-bucket creation, file upload/download explorer, and S3-compatible cloud storage gateway settings.
* **Edge Functions:** Serverless edge functions code compiler, deployment manager, and live Deno application logs streaming interface.
* **Model Gateway:** Direct OpenRouter model catalog configuration, API key management, and live credit/token usage metrics charts.
* **Compute Services:** Fly.io container configuration, region selection, and CPU/memory resource allocation interface.
* **Payments:** Integrated Stripe Checkout session manager and customer Billing Portal.
* **Analytics:** KPI statistics, retention rates, and posthog traffic monitoring panels.

---

## Technology Stack

This package leverages the following frontend stack:

| Layer | Library / Tool |
|---|---|
| **Core Framework** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Data Fetching / Caching** | [TanStack Query v5](https://tanstack.com/query/latest) (React Query) |
| **Styling & Theme** | [Tailwind CSS 4.1](https://tailwindcss.com/) (dark-mode design system) |
| **Routing** | [React Router DOM 7](https://reactrouter.com/) |
| **Code Editor** | [CodeMirror 6](https://codemirror.net/) (SQL, JavaScript, and JSON support) |
| **Data Visualizations** | [Recharts 3](https://recharts.org/) |
| **Diagrams & Graphs** | [@xyflow/react 12](https://reactflow.dev/) (interactive Schema ER diagrams) |
| **Real-time Engine** | [Socket.io Client 4.8](https://socket.io/docs/v4/client-api/) |

---

## Monorepo Wiring

In this Turborepo workspace, `@insforge/dashboard` is built as an independent, fully-typed NPM package.

```
insforge/
├── frontend/             ← Mounts and serves the dashboard
│   ├── src/
│   │   ├── App.tsx       ← Thin router selecting cloud vs self-host mode
│   │   └── self-hosting/ ← Delegates full routing to @insforge/dashboard
│   └── package.json      ← Declares dependency on "@insforge/dashboard": "*"
│
└── packages/
    └── dashboard/        ← THIS PACKAGE
        ├── src/
        │   ├── features/ ← Feature-specific pages and components
        │   └── router/   ← Consolidated AppRoutes router mapping
        └── package.json
```

---

## Dependency Boundaries

To maintain package isolation and clean separation of concerns, the `@insforge/dashboard` package adheres to the following dependency boundaries:

* **Internal Packages:** Depends strictly on `@insforge/shared-schemas` for data validation/contracts and `@insforge/ui` for shared UI primitives and components.
* **No Parent Dependencies:** Does not import or depend on the parent hosting shells (`frontend/` or enterprise cloud hosts). Configuration is passed down from the parent host at runtime via context providers.
* **Service Isolation:** Interacts with the `insforge-backend` server exclusively via HTTP REST endpoints and Socket.io WebSocket connections. No direct database or server-side internal modules are imported.

---

## Release Expectations

Build output: Vite + tsc produce ESM under dist/, with dist/index.js and dist/styles.css declared via exports in package.json.
Distribution: Currently consumed only via the monorepo workspace ("@insforge/dashboard": "*" in frontend/package.json). The package is not yet published to a public registry; the 0.0.0-dev.* versions track internal iterations.
Versioning: Will adopt SemVer once the package is published externally. Until then, treat any change as potentially breaking for host shells.

---

## Local Development

Before developing, make sure you have installed the root monorepo dependencies:
```bash
# From the repository root:
npm install
```

### Development Scripts

Inside `packages/dashboard/`, you can run the following package-specific commands:

```bash
# Run unit tests via Vitest
npm run test:unit

# Run component tests (Vitest + Testing Library)
npm run test:component

# Run end-to-end UI tests (Playwright)
npm run test:ui

# Type-check without emitting
npm run typecheck

# Verify code formatting and lint rules
npm run lint

# Compile and build the package
npm run build
```

Unit tests are written using `@testing-library/react` and Vitest to guarantee coverage of core feature pages, state-hooks, and form validators.
