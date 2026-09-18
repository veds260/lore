import type { Metadata } from 'next';
import './globals.css';

const DESCRIPTION =
  'An open source CMO that runs on your laptop. It reads how you write, drafts in your voice, and learns a rule from every edit you make.';

// Without metadataBase, the generated link-preview image resolves against
// localhost and the card comes out blank wherever the link is actually shared.
const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: 'Lore',
  description: DESCRIPTION,
  openGraph: {
    title: 'Lore',
    description: DESCRIPTION,
    siteName: 'Lore',
    type: 'website',
    url: origin,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lore',
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
