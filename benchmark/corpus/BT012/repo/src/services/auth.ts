// BUG: stale import path. db.js moved.
import { db } from './db-old.js';
export const auth = () => db.ping();
