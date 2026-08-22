type Company = {
  id: string;
  name: string;
  domain: string;
  role: string;
};

type Snapshot = {
  id: string;
  company_id: string;
  item_type: string;
  label: string;
  value_text: string;
  url: string;
  captured_at: string;
};

async function getCompetitors() {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/competitors`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/competitors failed: ${res.status}`);
  return res.json();
}

export default async function CompetitorsPage() {
  let companies: Company[] = [];
  let snapshots: Snapshot[] = [];
  let error: string | null = null;

  try {
    const data = await getCompetitors();
    companies = data.companies ?? [];
    snapshots = data.snapshots ?? [];
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main>
      <h1>Competitors</h1>
      <p>Pricing, changelog entries, and public activity for Linear and Asana.</p>
      {error && <p>Could not load competitors: {error}</p>}
      {!error && companies.length === 0 && <p>No competitors yet.</p>}
      {companies.map((c) => {
        const snaps = snapshots.filter((s) => s.company_id === c.id);
        return (
          <section key={c.id} style={{ marginBottom: '2rem' }}>
            <h2><a href={`/competitors/${c.id}`}>{c.name}</a> ({c.domain})</h2>
            {snaps.length === 0 && <p>No snapshots yet.</p>}
            {snaps.length > 0 && (
              <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Label</th>
                    <th>Value</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {snaps.map((s) => (
                    <tr key={s.id}>
                      <td>{s.item_type}</td>
                      <td>{s.label}</td>
                      <td>{s.value_text}</td>
                      <td><a href={s.url} target="_blank" rel="noreferrer">link</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </main>
  );
}
