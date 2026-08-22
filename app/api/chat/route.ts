import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '../../../src/api/db';
import { getChat } from '../../../src/api/routes';

const ChatBody = z.object({ question: z.string().min(1) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = ChatBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body must be { question: string }' }, { status: 400 });
  }

  try {
    const result = await getChat(getDb(), parsed.data.question);
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
