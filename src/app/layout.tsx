import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Georgian } from 'next/font/google';
import '../styles/tailwind.css';

const notoSansGeorgian = Noto_Sans_Georgian({
  subsets: ['georgian'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'GeoNav — Navigation for Georgia',
  description: 'Tesla-optimized driving navigation for Georgia. Search Georgian addresses, get real routes, navigate in Georgian or English.',
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ka" className={notoSansGeorgian.variable}>
      <body className={notoSansGeorgian.className}>
        {children}

        <script type="module" async src="https://static.rocket.new/rocket-web.js?_cfg=https%3A%2F%2Fgeonav4154back.builtwithrocket.new&_be=https%3A%2F%2Fappanalytics.rocket.new&_v=0.1.20" />
        <script type="module" defer src="https://static.rocket.new/rocket-shot.js?v=0.0.3" /></body>
    </html>
  );
}