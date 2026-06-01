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
│   └── package.json      ← Declares dependency on "@insforge/dashboard": "workspace:*"
│
55: └── packages/
56:     └── dashboard/        ← THIS PACKAGE
57:         ├── src/
58:         │   ├── features/ ← Feature-specific pages and components
59:         │   └── router/   ← Consolidated AppRoutes router mapping
60:         └── package.json
```

---

## Dependency Boundaries

To maintain package isolation and clean separation of concerns, the `@insforge/dashboard` package adheres to the following dependency boundaries:

* **Internal Packages:** Depends strictly on `@insforge/shared-schemas` for data validation/contracts and `@insforge/ui` for shared UI primitives and components.
* **No Parent Dependencies:** Does not import or depend on the parent hosting shells (`frontend/` or enterprise cloud hosts). Configuration is passed down from the parent host at runtime via context providers.
* **Service Isolation:** Interacts with the `insforge-backend` server exclusively via HTTP REST endpoints and Socket.io WebSocket connections. No direct database or server-side internal modules are imported.

---

## Release Expectations

The `@insforge/dashboard` package conforms to standard build and release patterns:

* **Build Target:** Bundled using Vite and TypeScript into a compiled ESM package located in `/dist` (`dist/index.js` for script logic, and `dist/styles.css` for styling).
* **Versioning:** Follows Semantic Versioning (SemVer) guidelines. Major version bumps are reserved for breaking API changes in host routing or initialization contracts.
* **Downstream Integration:** Consumed dynamically by the self-hosting shell (`frontend`) and the cloud host via standard monorepo workspace resolution or NPM registry installs.

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

# Run UI/component tests
npm run test:ui

# Verify code formatting and lint rules
npm run lint

# Compile and build the package
npm run build
```

Unit tests are written using `@testing-library/react` and Vitest to guarantee coverage of core feature pages, state-hooks, and form validators.
