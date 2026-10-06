/* global process */
/** The browser only ever talks to its own origin; Next proxies API calls so the httpOnly refresh cookie stays same-site. */
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true }, // linting runs once at the repo root
  // The operator console proxies /platform only when deliberately switched on (prefer a separate, IP-restricted deployment).
  async rewrites() { return [{ source: '/v1/:path*', destination: `${API}/v1/:path*` }, ...(process.env.OPERATOR_CONSOLE === 'on' ? [{ source: '/platform/:path*', destination: `${API}/platform/:path*` }] : [])]; },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'", "media-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ') }, // Next's inline bootstrap needs 'unsafe-inline' for scripts (no nonces in static export); everything else is same-origin only
      ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
    ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }];
  },
};
