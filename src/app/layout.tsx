import { AccountSession } from "@/lib/client/profile";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cambio",
  description: "The memory card game, live with friends. One join code. Play with friends and keep your record.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="min-h-full"><AccountSession />{children}</body>
    </html>
  );
}
