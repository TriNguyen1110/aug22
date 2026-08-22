import { Card, CardHeader, CardBody, Chip, Divider, Link } from '@heroui/react';

type PipelineHealth = {
  naive: {
    url: string;
    status: number;
    bytes: number;
    records_found: number;
    note: string;
  };
  brightdata: {
    attempted: boolean;
    ok: boolean;
    records_extracted: number;
    last_ingest_at: string | null;
    cache_path: string | null;
  };
};

async function getPipelineHealth(): Promise<PipelineHealth | null> {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/pipeline-health`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

const cards = [
  {
    href: '/trends',
    title: 'Trends',
    description:
      "Burst-detected discourse on r/Notion, r/SaaS, r/productivity, r/Linear, and r/asana.",
  },
  {
    href: '/competitors',
    title: 'Competitors',
    description: 'Pricing, changelog, and activity for Linear and Asana.',
  },
  {
    href: '/monitoring',
    title: 'Monitoring',
    description: "How people react to Notion's own posts.",
  },
];

export default async function HomePage() {
  const health = await getPipelineHealth();
  const naiveOk = !!health && health.naive.status >= 200 && health.naive.status < 300 && health.naive.records_found > 0;
  const brightGood = !!health && health.brightdata.records_extracted > 0;

  return (
    <main>
      <section className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Notion Market Watch
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-600">
          A statistics-first view of what people are saying about Notion, Linear, and
          Asana &mdash; every trend and finding traces back to a real, cited post.
        </p>
      </section>
      <section className="grid gap-6 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.href} className="border border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <Link href={c.href} className="text-xl font-semibold text-slate-900">
                {c.title}
              </Link>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-slate-600">{c.description}</p>
              <Link href={c.href} className="mt-4 inline-block text-sm font-medium">
                View {c.title.toLowerCase()} &rarr;
              </Link>
            </CardBody>
          </Card>
        ))}
      </section>

      <Divider className="my-10" />

      <section className="mb-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Naive fetch vs. Bright Data
        </h2>
        <p className="mt-2 max-w-2xl text-slate-600">
          What happens when you hit the source directly with a plain HTTP request, versus
          going through the ingest pipeline. Live from <code>/api/pipeline-health</code>.
        </p>
      </section>

      {!health && (
        <p className="text-red-600">Could not load pipeline health.</p>
      )}

      {health && (
        <section className="grid gap-6 sm:grid-cols-2">
          <Card className={`border shadow-sm ${naiveOk ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}>
            <CardHeader className="flex items-center justify-between pb-0">
              <span className="text-lg font-semibold text-slate-900">Naive fetch</span>
              <Chip size="sm" variant="flat" color={naiveOk ? 'success' : 'danger'}>
                {naiveOk ? 'usable' : 'blocked / empty'}
              </Chip>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">URL</dt>
                  <dd className="break-all text-right font-mono text-xs text-slate-700">
                    {health.naive.url}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Status</dt>
                  <dd className={naiveOk ? 'text-slate-700' : 'font-semibold text-red-700'}>
                    {health.naive.status}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Bytes</dt>
                  <dd className="text-slate-700">{health.naive.bytes.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Records found</dt>
                  <dd className={health.naive.records_found > 0 ? 'text-slate-700' : 'font-semibold text-red-700'}>
                    {health.naive.records_found}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Note</dt>
                  <dd className="mt-1 text-slate-700">{health.naive.note}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card className={`border shadow-sm ${brightGood ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
            <CardHeader className="flex items-center justify-between pb-0">
              <span className="text-lg font-semibold text-slate-900">Bright Data pipeline</span>
              <Chip size="sm" variant="flat" color={brightGood ? 'success' : 'default'}>
                {brightGood ? 'records extracted' : 'no records'}
              </Chip>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Live attempt made</dt>
                  <dd className="text-slate-700">
                    {health.brightdata.attempted ? 'yes' : 'no (using cached ingest)'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Records extracted</dt>
                  <dd className={brightGood ? 'font-semibold text-emerald-700' : 'text-slate-700'}>
                    {health.brightdata.records_extracted}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Last ingest at</dt>
                  <dd className="text-slate-700">{health.brightdata.last_ingest_at ?? 'never'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Cache path</dt>
                  <dd className="text-slate-700">{health.brightdata.cache_path ?? 'none'}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </section>
      )}
    </main>
  );
}
