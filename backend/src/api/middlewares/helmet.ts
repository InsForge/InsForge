import helmet from 'helmet';
import { RequestHandler } from 'express';

/**
 * Extracted into its own module (rather than inlined in server.ts) so the
 * regression test in helmet-security-headers.test.ts can import and exercise
 * this exact configuration — a copy hand-duplicated in the test would keep
 * passing even if this one drifted or regressed.
 */
export const helmetMiddleware: RequestHandler = helmet({
  // The dashboard SPA and client apps embed third-party scripts/styles/images
  // this project doesn't control, so a strict default CSP would break them;
  // this hardening is scoped to the explicit header list below instead.
  contentSecurityPolicy: false,
  // Storage objects and API responses are deliberately fetched cross-origin
  // by client apps (that's the point of a hosted backend), so the
  // same-origin default here would break exactly the traffic this API serves.
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  // Helmet's default ('same-origin') severs `window.opener` for a popup
  // opened from a different origin, breaking the cloud-hosting dashboard's
  // opener-messaging bridge (frontend/src/cloud-hosting/useCloudHosting.ts,
  // packages/dashboard/src/layout/AppLayout.tsx). This keeps the isolation
  // benefit for same-origin popups while still allowing that bridge.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Helmet's default X-Frame-Options ('SAMEORIGIN') would stop the dashboard
  // from rendering at all in the cloud-hosting partner's cross-origin parent
  // iframe — useCloudHosting.ts documents that PROJECT_INFO only ever
  // arrives from a parent iframe, i.e. that embed is a supported, expected
  // flow, not something to guard against. X-Frame-Options has no origin-list
  // form, so it can't express "this partner, not everyone" — real framing
  // protection comes from the scoped `frame-ancestors` CSP directive set by
  // frameAncestorsMiddleware (mounted alongside this in server.ts), which
  // modern browsers honor in preference to X-Frame-Options anyway.
  frameguard: false,
});
