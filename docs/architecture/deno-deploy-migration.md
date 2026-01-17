# InsForge Functions: Deno Deploy Migration Analysis

**Status**: Draft / Under Review
**Date**: 2026-01-14
**Author**: Architecture Discussion

---

## Executive Summary

This document explores migrating InsForge's serverless function execution from self-hosted Deno containers (per-customer EC2) to Deno Deploy's managed edge infrastructure.

**Key Question**: Can we offload function execution to Deno Deploy while keeping each customer's data isolated on their own EC2/Postgres?

---

## 1. Current Architecture

### 1.1 Per-Customer Stack

Each InsForge customer gets their own isolated EC2 instance:

```
Customer EC2
├── InsForge Container (:7130)  - API, Auth, Storage, etc.
├── Deno Container (:7133)      - Function execution
├── Postgres Container (:5432)  - All data
└── (Other services...)
```

### 1.2 Function Execution Flow (Current)

```
1. User saves function code
   └── InsForge API → INSERT INTO functions.definitions

2. User invokes function
   └── POST /functions/hello-world
       └── InsForge proxies to Deno container
           └── Deno queries Postgres for code
               └── Deno executes in Web Worker
                   └── Response returned
```

### 1.3 Current Pain Points

| Issue | Impact |
|-------|--------|
| Resource contention | Heavy function load can crash EC2, taking down InsForge + Postgres |
| No auto-scaling | Fixed EC2 capacity limits function throughput |
| Single region | Users far from EC2 region experience latency |
| Not truly serverless | Customers pay for EC2 whether functions run or not |

---

## 2. Proposed Architecture

### 2.1 Overview

Move function execution to Deno Deploy while keeping InsForge + Postgres on customer EC2.

```
                         Deno Deploy (Shared)
                         ┌─────────────────────┐
                         │   Function Runner   │
                         │   (1 deployment)    │
                         └──────────┬──────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
   Customer A EC2            Customer B EC2            Customer C EC2
   ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
   │ InsForge    │           │ InsForge    │           │ InsForge    │
   │ Postgres    │           │ Postgres    │           │ Postgres    │
   └─────────────┘           └─────────────┘           └─────────────┘
```

### 2.2 Request Flow (Proposed)

```
1. User invokes function
   POST https://customer-a.insforge.app/functions/hello-world

2. InsForge (on EC2) receives request
   - Prepares signed payload with DB connection info
   - Proxies to Deno Deploy

3. Deno Deploy (edge) receives request
   - Validates signed payload
   - Connects to Customer A's Postgres
   - Fetches function code + secrets
   - Executes with new Function()
   - Returns response

4. InsForge returns response to user
```

---

## 3. Technical Validation

### 3.1 Confirmed Working

| Feature | Status | Evidence |
|---------|--------|----------|
| `new Function()` on Deno Deploy | ✅ Confirmed | Tested live: https://insforge-new-function-test.deno.dev |
| `eval()` on Deno Deploy | ✅ Confirmed | Same test |
| InsForge-style wrapper pattern | ✅ Confirmed | Tested with exports/module/createClient/Deno params |
| External Postgres connection | ✅ Documented | Deno Deploy supports postgres drivers |

### 3.2 Test Results

```json
{
  "tests": {
    "basicNewFunction": { "success": true, "output": 42 },
    "insforgeStyleWrapper": { "success": true },
    "eval": { "success": true, "output": 6 }
  },
  "summary": { "allPassed": true }
}
```

---

## 4. Open Questions & Concerns

### 4.1 Database Connectivity

**Problem**: Deno Deploy runs on global edge. How does it reach each customer's Postgres on their EC2?

| Option | Pros | Cons |
|--------|------|------|
| Public Postgres IP + SSL | Simple | Security exposure, need firewall rules |
| Cloudflare Tunnel / Tailscale | Secure, no public IP | Added complexity, latency? |
| Managed Postgres (Neon, Supabase) | Built for edge access | Customers must migrate DB |
| VPN / Private network | Most secure | Complex setup per customer |

**Question**: What's the acceptable security posture for exposing Postgres?

### 4.2 Latency

**Problem**: Current setup has ~1ms DB latency (same EC2). Deno Deploy → Customer EC2 could be 50-200ms+.

```
Current:   Deno Container → Postgres = ~1ms
Proposed:  Deno Deploy (Tokyo) → Postgres (us-east-1) = ~150-300ms
```

**Mitigations**:
- Cache function code in Deno KV (after first fetch)
- Choose edge region closest to customer's EC2
- Accept latency trade-off for scalability benefit

**Question**: Is 150-300ms additional latency acceptable for the scaling benefits?

### 4.3 Secret Transmission

**Problem**: Currently, secrets are decrypted inside the Deno container on the same EC2. With Deno Deploy, we need to either:

| Option | How it works | Security |
|--------|--------------|----------|
| A. Decrypt on EC2, send to Deploy | InsForge decrypts, includes in signed payload | Secrets traverse network (encrypted in transit) |
| B. Send encryption key to Deploy | Deno Deploy fetches + decrypts | Encryption key traverses network |
| C. Deno Deploy fetches secrets via API | InsForge exposes /internal/secrets endpoint | Need to secure internal endpoint |

**Question**: Which secret handling approach is acceptable?

### 4.4 Multi-Tenant Security

**Problem**: One Deno Deploy app handles ALL customers' functions. What if:
- Customer A's function tries to access Customer B's DB?
- Malicious code in one function affects others?

**Mitigations**:
- Each request includes signed/encrypted DB credentials (can't forge)
- Deno Deploy V8 isolates provide per-request isolation
- No shared state between requests
- Connection is made fresh per request (or pooled per-customer)

**Question**: Is V8 isolate-level isolation sufficient, or do we need VM-level (Deno Sandbox)?

### 4.5 Connection Pooling

**Problem**: Each function invocation creates a new DB connection. At scale:
- 1000 concurrent requests = 1000 connections to same Postgres
- Postgres default max_connections = 100

**Solutions**:
- Use connection pooler (PgBouncer) on EC2
- Use managed pooling (Neon, Supabase built-in)
- Implement connection reuse in Deno Deploy (complex)

**Question**: How do we handle connection pooling for edge → EC2 Postgres?

### 4.6 Error Handling & Debugging

**Problem**: Currently, function logs go to Deno container logs on EC2. With Deno Deploy:
- Logs are in Deno Deploy dashboard (centralized across all customers)
- How to attribute logs to specific customer?
- How to give customers access to their logs?

**Question**: How do we handle logging and debugging?

### 4.7 Cost Model

**Current**: Included in EC2 cost (no marginal cost per function invocation)

**Proposed**: Deno Deploy pricing

| Tier | Requests/mo | CPU Time | Cost |
|------|-------------|----------|------|
| Free | 1M | 15h | $0 |
| Pro | 5M, then $2/M | 40h, then $0.05/h | $20/mo |

**Question**: Who pays for Deno Deploy usage?
- InsForge (included in customer plan)?
- Pass-through to customer?
- Per-invocation billing?

---

## 5. Implementation Approach

### 5.1 Phase 1: Proof of Concept

1. Create Deno Deploy runner that:
   - Accepts signed request with DB config
   - Connects to test Postgres
   - Fetches and executes function code
   - Returns response

2. Test with single customer (internal/staging)

3. Measure:
   - Latency (end-to-end)
   - Cold start impact
   - DB connection behavior

### 5.2 Phase 2: Security Hardening

1. Implement signed payload verification
2. Add rate limiting per customer
3. Set up proper secret handling
4. Audit isolation guarantees

### 5.3 Phase 3: Migration

1. Add feature flag for Deno Deploy execution
2. Migrate customers incrementally
3. Monitor and compare metrics
4. Remove Deno container from EC2 once stable

---

## 6. Alternative Approaches

### 6.1 Keep Current + Scale EC2

Instead of Deno Deploy, just use bigger EC2 or add horizontal scaling.

| Pros | Cons |
|------|------|
| No architecture change | Still single region |
| Data stays local | Manual scaling |
| No new security concerns | Cost scales linearly |

### 6.2 Deno Sandbox (MicroVMs)

Use Deno Sandbox instead of Deno Deploy for maximum isolation.

| Pros | Cons |
|------|------|
| Full VM isolation | Alpha product |
| Can run any code | 5 concurrent limit (currently) |
| More secure | 2 regions only |

### 6.3 Per-Customer Deno Deploy Projects

Each customer gets their own Deno Deploy project.

| Pros | Cons |
|------|------|
| True isolation | Deployment management complexity |
| Customer-specific limits | Need to provision per customer |
| Separate billing possible | More ops overhead |

### 6.4 Cloudflare Workers for Platforms

Similar concept to Deno Subhosting but from Cloudflare.

| Pros | Cons |
|------|------|
| Massive scale | Different API/runtime |
| Global edge | Migration effort |
| Mature platform | Need to evaluate limits |

---

## 7. Recommendation

**Pending further analysis.** Key decisions needed:

1. **Database connectivity**: How will Deno Deploy reach customer Postgres?
2. **Latency tolerance**: Is 150-300ms additional latency acceptable?
3. **Security model**: How do we handle secrets and multi-tenant isolation?
4. **Cost ownership**: Who pays for Deno Deploy usage?

### Suggested Next Steps

1. [ ] Prototype with test Postgres exposed via Cloudflare Tunnel
2. [ ] Measure actual latency in realistic scenario
3. [ ] Security review of signed payload approach
4. [ ] Cost modeling for expected usage patterns
5. [ ] Decision meeting with stakeholders

---

## 8. References

- [Deno Deploy Docs](https://docs.deno.com/deploy/)
- [GitHub Issue #140 - eval/new Function enabled](https://github.com/denoland/deploy_feedback/issues/140)
- [Deno Deploy Pricing](https://deno.com/deploy/pricing)
- [Test Deployment](https://insforge-new-function-test.deno.dev)
- Current InsForge function code: `/functions/server.ts`, `/functions/worker-template.js`
