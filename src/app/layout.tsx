import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./theme-bronze.generated.css";
import "./theme-bronze.css";
import { Providers } from "./providers";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "MoneyToHome",
  description: "Kho proxy, Server / VM, EarnApp và thu chi",
};

const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem("bdops-settings")||"null"),t=s&&s.state&&s.state.theme;document.documentElement.setAttribute("data-theme",t==="bronze"?"bronze":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before the settings are read: the old default (dark), or a saved "Đồng ấm" (key bdops-settings, src/lib/settings-store.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
