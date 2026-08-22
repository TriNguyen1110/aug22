import { Card, CardHeader, CardBody, Chip, Divider, Link } from '@heroui/react';
import { TrendingUp, Building2, Radio, ArrowRight } from 'lucide-react';

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
    icon: TrendingUp,
    description:
      'Burst-detected discourse on r/Notion, r/SaaS, r/productivity, r/Linear, and r/asana.',
  },
  {
    href: '/competitors',
    title: 'Competitors',
    icon: Building2,
    description: 'Pricing, changelog, and activity for Linear and Asana.',
  },
  {
    href: '/monitoring',
    title: 'Monitoring',
    icon: Radio,
    description: "How people react to Notion's own posts.",
  },
];

export default async function HomePage() {
  const health = await getPipelineHealth();
  const naiveOk = !!health && health.naive.status >= 200 && health.naive.status < 300 && health.naive.records_found > 0;
  const brightGood = !!health && health.brightdata.records_extracted > 0;

  return (
    <main>
      <section className="mb-16">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-teal">
          Market intelligence
        </p>
        <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight text-[#eef1f0]">
          Notion Market Watch
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-silver">
          A statistics-first view of what people are saying about Notion, Linear, and
          Asana &mdash; every trend and finding traces back to a real, cited post.
        </p>
      </section>

      <section className="grid gap-5 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.href} className="glass-card bg-transparent">
              <CardHeader className="flex items-center gap-2.5 pb-0">
                <Icon className="h-4 w-4 text-forest-bright" strokeWidth={1.6} />
                <Link href={c.href} className="font-display text-xl font-semibold text-[#eef1f0]">
                  {c.title}
                </Link>
              </CardHeader>
              <CardBody>
                <p className="text-sm leading-relaxed text-silver">{c.description}</p>
                <Link
                  href={c.href}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-teal transition-colors hover:text-teal-dim"
                >
                  View {c.title.toLowerCase()} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <Divider className="my-12 divider-hair" />

      <section className="mb-6">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-[#eef1f0]">
          Naive fetch vs. Bright Data
        </h2>
        <p className="mt-2 max-w-2xl text-silver">
          What happens when you hit the source directly with a plain HTTP request, versus
          going through the ingest pipeline. Live from <code className="text-silver-dim">/api/pipeline-health</code>.
        </p>
      </section>

      {!health && (
        <p className="text-red-400">Could not load pipeline health.</p>
      )}

      {health && (
        <section className="grid gap-5 sm:grid-cols-2">
          <Card className={`glass-card bg-transparent ${naiveOk ? '' : 'border-red-500/30'}`}>
            <CardHeader className="flex items-center justify-between pb-0">
              <span className="font-display text-lg font-semibold text-[#eef1f0]">Naive fetch</span>
              <Chip
                size="sm"
                variant="flat"
                className={naiveOk ? 'chip-score' : 'bg-red-500/10 text-red-400 border border-red-500/30'}
              >
                {naiveOk ? 'usable' : 'blocked / empty'}
              </Chip>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">URL</dt>
                  <dd className="break-all text-right font-mono text-xs text-silver">
                    {health.naive.url}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Status</dt>
                  <dd className={naiveOk ? 'text-silver' : 'font-semibold text-red-400'}>
                    {health.naive.status}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Bytes</dt>
                  <dd className="text-silver">{health.naive.bytes.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Records found</dt>
                  <dd className={health.naive.records_found > 0 ? 'text-silver' : 'font-semibold text-red-400'}>
                    {health.naive.records_found}
                  </dd>
                </div>
                <div>
                  <dt className="text-silver-dim">Note</dt>
                  <dd className="mt-1 text-silver">{health.naive.note}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card className={`glass-card bg-transparent ${brightGood ? 'border-forest/40' : ''}`}>
            <CardHeader className="flex items-center justify-between pb-0">
              <span className="font-display text-lg font-semibold text-[#eef1f0]">Bright Data pipeline</span>
              <Chip
                size="sm"
                variant="flat"
                className={brightGood ? 'bg-forest/15 text-forest-bright border border-forest/40' : 'bg-white/5 text-silver border border-silver/20'}
              >
                {brightGood ? 'records extracted' : 'no records'}
              </Chip>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Live attempt made</dt>
                  <dd className="text-silver">
                    {health.brightdata.attempted ? 'yes' : 'no (using cached ingest)'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Records extracted</dt>
                  <dd className={brightGood ? 'font-semibold text-forest-bright' : 'text-silver'}>
                    {health.brightdata.records_extracted}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Last ingest at</dt>
                  <dd className="text-silver">{health.brightdata.last_ingest_at ?? 'never'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silver-dim">Cache path</dt>
                  <dd className="text-silver">{health.brightdata.cache_path ?? 'none'}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </section>
      )}
    </main>
  );
}
