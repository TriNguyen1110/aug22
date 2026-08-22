// Route logic lives in src/api/routes.ts (backend-owned). This file is the minimal
// Next.js App Router plumbing required to expose it at /api/pipeline-health.
import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getPipelineHealth } from '../../../src/api/routes';

export async function GET() {
  const result = await getPipelineHealth(getDb());
  return NextResponse.json(result);
}
