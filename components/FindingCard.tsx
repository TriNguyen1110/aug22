import { Card, CardBody, Link } from '@heroui/react';

type Post = {
  id: string;
  url: string;
  author: string;
  platform: string;
  text: string;
};

type Finding = {
  id: string;
  post_id: string;
  claim: string;
  quote: string;
  category: string;
  confidence: number;
};

export function FindingCard({ finding, post }: { finding: Finding; post: Post | undefined }) {
  return (
    <Card className="glass-card bg-transparent">
      <CardBody className="flex flex-col gap-4 p-6 sm:p-7">
        <p className="text-base leading-relaxed text-[#eef1f0]">{finding.claim}</p>
        <blockquote className="border-l-2 border-teal/40 pl-4 text-base italic leading-relaxed text-silver">
          &quot;{finding.quote}&quot;
        </blockquote>
        <div className="flex flex-wrap items-center gap-2 border-t border-silver/10 pt-4 text-sm">
          <span className="text-silver-dim">Source</span>
          {post ? (
            <Link
              href={post.url}
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:text-teal-dim"
            >
              {post.platform} / {post.author}
            </Link>
          ) : (
            <span className="text-silver-dim">post unavailable</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
