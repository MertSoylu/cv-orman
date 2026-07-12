import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { DarkModeProvider } from "@/context/DarkModeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import {
  MAIN_SITE_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Static metadata only -- do NOT call headers()/cookies() here. That forces
// the whole tree dynamic and kills `revalidate` on `/` (see page.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Mert Soylu", url: MAIN_SITE_URL }],
  creator: "Mert Soylu",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "tr_TR",
    alternateLocale: ["en_US"],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#131110" },
  ],
};

// Applies the saved dark-mode preference before first paint (default dark),
// same recipe as mertsoylu.dev's index.html -- avoids a light/dark flash on
// load. Runs synchronously in <head>, ahead of DarkModeProvider's own effect.
const THEME_INIT_SCRIPT = `(function () {
  try {
    var savedDark = localStorage.getItem('cv-orman-dark-mode');
    var dark = savedDark !== null ? JSON.parse(savedDark) : true;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
  try {
    var savedLang = localStorage.getItem('cv-orman-language');
    if (savedLang) {
      var lang = JSON.parse(savedLang);
      if (lang === 'tr' || lang === 'en') document.documentElement.lang = lang;
    }
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-fg">
        <LanguageProvider>
          <DarkModeProvider>{children}</DarkModeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
