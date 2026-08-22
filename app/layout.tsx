export const metadata = {
  title: 'Notion Market Watch',
  description: 'Trend, competitor, and monitoring dashboard for Notion',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem', color: '#111' }}>
        <nav style={{ marginBottom: '1.5rem' }}>
          <a href="/" style={{ marginRight: '1rem' }}>Home</a>
          <a href="/trends" style={{ marginRight: '1rem' }}>Trends</a>
          <a href="/competitors" style={{ marginRight: '1rem' }}>Competitors</a>
          <a href="/monitoring">Monitoring</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
