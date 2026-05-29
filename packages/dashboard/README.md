# @insforge/dashboard

The comprehensive, shared React administration dashboard interface for the **InsForge** Backend-as-a-Service (BaaS) platform. 

This package is the single source of truth for the project administration interface, shared and consumed by:
1. The local self-hosting app in `/frontend` of this repository.
2. The enterprise `insforge-cloud` cloud-hosted dashboard.

---

## 🚀 Key Feature Modules

The dashboard is organized into focused, high-fidelity React feature modules:

* **🗄️ Database Explorer:** Interactive table schema designer, live spreadsheet-style records editor powered by `react-data-grid`, foreign key helper, and an advanced SQL Editor console.
* **🔑 Authentication:** User profile table management, signup/login status controls, and detailed third-party OAuth provider configurations.
* **📦 Storage Browser:** Multi-bucket creation, file upload/download explorer, and S3-compatible cloud storage gateway settings.
* **⚡ Edge Functions:** Serverless edge functions code compiler, deployment manager, and live Deno application logs streaming interface.
* **🤖 Model Gateway:** Direct OpenRouter model catalog configuration, API key management, and live credit/token usage metrics charts.
* **☁️ Compute Services:** Fly.io container configuration, region selection, and CPU/memory resource allocation interface.
* **💳 Payments:** Integrated Stripe Checkout session manager and customer Billing Portal.
* **📈 Analytics:** KPI statistics, retention rates, and posthog traffic monitoring panels.

---

## 🛠️ Technology Stack

This package leverages a cutting-edge frontend engineering stack:

| Layer | Library / Tool |
|---|---|
| **Core Framework** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Data Fetching / Caching** | [TanStack Query v5](https://tanstack.com/query/latest) (React Query) |
| **Styling & Theme** | [Tailwind CSS 3.4](https://tailwindcss.com/) (harmonic dark-mode design system) |
| **Routing** | [React Router DOM 7](https://reactrouter.com/) |
| **Code Editor** | [CodeMirror 6](https://codemirror.net/) (SQL, JavaScript, and JSON support) |
| **Data Visualizations** | [Recharts 3](https://recharts.org/) |
| **Diagrams & Graphs** | [@xyflow/react 12](https://reactflow.dev/) (interactive Schema ER diagrams) |
| **Real-time Engine** | [Socket.io Client 4.8](https://socket.io/docs/v4/client-api/) |

---

## 🏗️ Monorepo Wiring

In this Turborepo workspace, `@insforge/dashboard` is built as an independent, fully-typed NPM package. 

```
insforge/
├── frontend/             ← Mounts and serves the dashboard
│   ├── src/
│   │   ├── App.tsx       ← Thin router selecting cloud vs self-host mode
│   │   └── self-hosting/ ← Delegates full routing to @insforge/dashboard
│   └── package.json      ← Declares dependency on "@insforge/dashboard": "workspace:*"
│
└── packages/
    └── dashboard/        ← THIS PACKAGE
        ├── src/
        │   ├── features/ ← Feature-specific pages and components
        │   └── router/   ← Consolidated AppRoutes router mapping
        └── package.json
```

---

## 💻 Local Development

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

Unit tests are written using `@testing-library/react` and Vitest to guarantee robust coverage of core feature pages, state-hooks, and form validators.
