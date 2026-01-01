import type { Metadata } from "next";
import "./globals.css";
import { GitPullRequest } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "Claude Reviewer - Local PR Review",
  description: "Review Claude's code changes locally with inline commenting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600, fontSize: '1.25rem', textDecoration: 'none', color: 'inherit' }}>
            <GitPullRequest size={24} />
            Claude Reviewer
          </Link>
          <div style={{ fontSize: '0.9rem', color: '#8b949e' }}>
            Local PR Review System
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
