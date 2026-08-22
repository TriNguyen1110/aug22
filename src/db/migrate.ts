/**
 * Creates the SQLite tables from CONTRACT.md's schema at DB_PATH if they don't exist.
 * Idempotent. DDL matches tools/seed.mjs exactly so there is no drift between the two.
 *
 * Usage: bun run src/db/migrate.ts
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function migrate(dbPath = process.env.DB_PATH ?? './data/app.db') {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    create table if not exists companies (
      id text primary key, name text, domain text, role text,
      industry text, market_share real, size text, niche text
    );
    create table if not exists posts (
      id text primary key, company_id text, source_type text, platform text,
      author text, url text, text text, posted_at text, fetched_at text
    );
    create table if not exists trends (
      id text primary key, term text, recent_count integer, prior_count integer,
      score real, window_start text, window_end text
    );
    create table if not exists findings (
      id text primary key, post_id text, trend_id text, company_id text, use_case text,
      claim text, quote text, category text, confidence real
    );
    create table if not exists competitor_snapshots (
      id text primary key, company_id text, item_type text, label text,
      value_text text, url text, captured_at text
    );
  `);

  // Existing DB files predate the industry/market_share/size/niche columns added to
  // CONTRACT.md. `create table if not exists` above is a no-op against an already-
  // existing table, so backfill the columns here if this DB was created before them.
  const existingCols = new Set((db.prepare('pragma table_info(companies)').all() as { name: string }[]).map((c) => c.name));
  if (!existingCols.has('industry')) db.exec('alter table companies add column industry text');
  if (!existingCols.has('market_share')) db.exec('alter table companies add column market_share real');
  if (!existingCols.has('size')) db.exec('alter table companies add column size text');
  if (!existingCols.has('niche')) db.exec('alter table companies add column niche text');

  return db;
}

// Run directly: node --import tsx src/db/migrate.ts (or `npm run migrate`)
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  const db = migrate();
  console.log(`migrated ${process.env.DB_PATH ?? './data/app.db'}`);
  db.close();
}
