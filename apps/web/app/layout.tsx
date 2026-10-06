import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '../components/RegisterSW';

export const metadata: Metadata = { title: 'LeadDesk', description: 'Your next best action, one lead at a time.', manifest: '/manifest.webmanifest', icons: { icon: '/icon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#2358e6' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><RegisterSW />{children}</body></html>);
}
