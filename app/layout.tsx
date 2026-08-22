import './globals.css';
import { Providers } from './providers';
import { SiteNav } from '../components/SiteNav';

export const metadata = {
  title: 'Notion Market Watch',
  description: 'Trend, competitor, and monitoring dashboard for Notion',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
        <Providers>
          <SiteNav />
          <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
