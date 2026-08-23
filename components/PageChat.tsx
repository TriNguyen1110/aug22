'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, Link } from '@heroui/react';
import { ArrowRight, Sparkles } from 'lucide-react';

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
  const [statusMessage, setStatusMessage] = useState(
    'Checking live data and generating a grounded answer — this can take up to a minute.',
  );

  useEffect(() => {
    if (!loading) return;
    setStatusMessage(
      'Checking live data and generating a grounded answer — this can take up to a minute.',
    );
    const timer = setTimeout(() => {
      setStatusMessage('Still working — verifying sources...');
    }, 12000);
    return () => clearTimeout(timer);
  }, [loading]);

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
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-[#eef1f0]">
          <Sparkles className="h-5 w-5 text-teal" aria-hidden="true" />
          Ask about {label}
        </h2>
        <form onSubmit={submit} className="relative">
          <input
            aria-label="Ask a question"
            placeholder={`Ask a question about ${label.toLowerCase()}...`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full rounded-full border border-silver/15 bg-white/[0.04] py-3.5 pl-5 pr-14 text-[#eef1f0] placeholder:text-silver-dim/70 outline-none backdrop-blur-sm transition focus:border-teal/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-teal/20"
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={loading || !question.trim()}
            className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-teal text-[#0a0d0c] transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:scale-105 enabled:hover:brightness-110"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0a0d0c]/30 border-t-[#0a0d0c]" />
            ) : (
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </form>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-silver-dim" role="status" aria-live="polite">
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-silver/30 border-t-teal"
              aria-hidden="true"
            />
            {statusMessage}
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && (
          <div className="space-y-5 border-t border-silver/10 pt-5">
            {/* The API's answer text includes an explicit "Sources:" block with raw
                post_id/URL pairs (server-side requirement so the source is never lost
                even if this UI weren't rendering citations). We already render a clean,
                deduplicated citation list with real links right below, so showing that
                same information again as a wall of inline URLs is pure clutter -- strip
                everything from "Sources:" onward and only show the narrative answer. */}
            <p className="text-base leading-relaxed text-[#eef1f0]">
              {result.answer.split(/\n\s*Sources:/i)[0].trim()}
            </p>
            {result.citations.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-silver-dim">
                  Grounded in {result.citations.length} real {result.citations.length === 1 ? 'post' : 'posts'}
                </p>
                <ul className="space-y-3">
                  {result.citations.map((c) => (
                    <li key={c.post_id}>
                      <blockquote className="border-l-2 border-teal/40 pl-4 text-sm italic leading-relaxed text-silver">
                        &quot;{c.quote}&quot;
                      </blockquote>
                      <Link
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block pl-4 text-xs text-teal hover:text-teal-dim"
                      >
                        View source →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="border-t border-silver/10 pt-3 text-xs text-silver-dim">
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
