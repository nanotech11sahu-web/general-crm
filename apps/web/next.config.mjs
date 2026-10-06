/* global process */
/** The browser only ever talks to its own origin; Next proxies API calls so the httpOnly refresh cookie stays same-site. */
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true }, // linting runs once at the repo root
  async rewrites() { return [{ source: '/v1/:path*', destination: `${API}/v1/:path*` }]; },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }];
  },
};
