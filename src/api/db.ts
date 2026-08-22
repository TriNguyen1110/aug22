/**
 * Shared read-only-by-convention SQLite handle for API route handlers.
 * One process-wide connection, opened lazily so route modules can import it
 * without opening a handle at build time.
 */
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? './data/app.db';
    db = new Database(dbPath, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}
