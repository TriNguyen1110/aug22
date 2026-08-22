'use client';

import { useState } from 'react';
import { Card, CardBody, Input, Button, Link } from '@heroui/react';

type Citation = { post_id: string; quote: string; url: string };

type ChatResponse = {
  answer: string;
  citations: Citation[];
  brightdata: { attempted: boolean; ok: boolean; records_extracted: number; error?: string };
};

export function PageChat({ scope, label }: { scope: 'trends' | 'competitor' | 'own'; label: string }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, scope }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `request failed: ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="glass-card bg-transparent">
      <CardBody className="flex flex-col gap-4 p-6 sm:p-7">
        <h2 className="font-display text-xl font-semibold text-[#eef1f0]">Ask {label}</h2>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Ask a question"
            placeholder={`Ask a question about ${label.toLowerCase()}...`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="max-w-md"
          />
          <Button type="submit" isLoading={loading} className="bg-teal text-[#0a0d0c]">
            Ask
          </Button>
        </form>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && (
          <div className="space-y-3 border-t border-silver/10 pt-4">
            <p className="text-base leading-relaxed text-[#eef1f0]">{result.answer}</p>
            {result.citations.length > 0 && (
              <ul className="space-y-2">
                {result.citations.map((c) => (
                  <li key={c.post_id} className="text-sm text-silver">
                    &quot;{c.quote}&quot;{' '}
                    <Link
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal hover:text-teal-dim"
                    >
                      source
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-silver-dim">
              Checked live data: {result.brightdata.attempted ? (result.brightdata.ok ? 'yes' : 'attempted, failed') : 'no'}
              {typeof result.brightdata.records_extracted === 'number'
                ? ` (${result.brightdata.records_extracted} records)`
                : ''}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
