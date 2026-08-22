// CLI entry: bun/tsx run of the burst-score detector against the live DB.
import { migrate } from '../db/migrate.js';
import { runDetect } from './burst.js';

const db = migrate();
runDetect(db)
  .then((n) => {
    console.log(`[detect] wrote ${n} trend rows`);
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('[detect] FAILED', err.message);
    db.close();
    process.exit(1);
  });
