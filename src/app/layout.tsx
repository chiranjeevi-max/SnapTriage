/**
 * @module app/layout
 * Root layout for the SnapTriage application. Configures global fonts (Geist Sans
 * and Geist Mono), sets base metadata/OpenGraph tags, provides a skip-to-content
 * accessibility link, and wraps all pages in the client {@link Providers} stack.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Pages are rendered per request.
 *
 * The Content-Security-Policy is nonce-based (see `src/lib/csp.ts`), and
 * Next.js can only stamp a nonce onto its inline scripts while rendering a
 * request. A statically prerendered page is built without request headers, so
 * its scripts would carry no nonce and be blocked by the strict policy.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SnapTriage",
  description: "Keyboard-driven inbox for triaging GitHub & GitLab issues at speed",
  openGraph: {
    title: "SnapTriage",
    description: "Keyboard-driven inbox for triaging GitHub & GitLab issues at speed",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The proxy mints the nonce for this request; next-themes injects its own
  // inline script and needs it to satisfy the strict script-src policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
