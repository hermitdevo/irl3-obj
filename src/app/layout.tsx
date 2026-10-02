import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { Header } from "@/components/layout/header";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "IRL3 Objects",
  description: "Create objects and scan the world with your camera. Runs entirely on your own device.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Some mobile browsers (Chrome on iOS) inject attributes before React loads.
    <html lang="en" className={`${poppins.variable} antialiased`} suppressHydrationWarning>
      <body className="font-sans">
        <Header />
        <main className="py-8">{children}</main>
      </body>
    </html>
  );
}
