import './globals.css';
import { Playfair_Display, Inter } from 'next/font/google';
import { Providers } from './providers';
import { SiteNav } from '../components/SiteNav';
import { SiteFooter } from '../components/SiteFooter';

const display = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata = {
  title: 'Meridian',
  description: 'Trend, competitor, and monitoring dashboard for Notion',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col bg-ink text-[#dfe6e3] font-sans antialiased">
        <Providers>
          <SiteNav />
          <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:px-8 sm:py-20">
            {children}
          </div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
