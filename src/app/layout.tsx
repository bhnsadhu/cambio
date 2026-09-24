import { PresenceSession } from "@/lib/client/presence";
import { AccountSession } from "@/lib/client/profile";
import { NotificationProvider } from "@/components/Notification";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const shareImage = {
  url: `${SITE_URL}/social/cambio.png`,
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Cambio — the memory card game, live with friends. Playing cards on a black background with mint accents.",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Cambio",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Cambio",
    title: "Cambio — Play with friends",
    description: SITE_DESCRIPTION,
    url: "./",
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cambio — Play with friends",
    description: SITE_DESCRIPTION,
    images: [shareImage],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="min-h-full"><NotificationProvider><AccountSession /><PresenceSession />{children}</NotificationProvider></body>
    </html>
  );
}
