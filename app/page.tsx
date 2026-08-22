import { Card, CardHeader, CardBody, Link } from '@heroui/react';

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

export default function HomePage() {
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
    </main>
  );
}
