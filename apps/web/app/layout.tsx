import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '../components/RegisterSW';
import { Shell } from '../components/Shell';

export const metadata: Metadata = { title: 'LeadDesk', description: 'Your next best action, one lead at a time.', manifest: '/manifest.webmanifest', icons: { icon: '/icon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#4f46e5' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><RegisterSW /><Shell>{children}</Shell></body></html>);
}
