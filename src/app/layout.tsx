import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "sonner";
import { GenerationProvider } from "@/context/generation-context";
import { FloatingProgress } from "@/components/layout/floating-progress";

// Fuentes incluidas en el proyecto (licencia OFL): el build no depende de Google Fonts (funciona offline y en Docker)
const geistSans = localFont({
  src: "./fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "RADAR 593 · Viral Shorts",
  description: "Ideas en tendencia, guiones verificados y reels para YouTube, Instagram, Facebook y TikTok",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GenerationProvider>
          {children}
          <Toaster />
          <FloatingProgress />
        </GenerationProvider>
      </body>
    </html>
  );
}
