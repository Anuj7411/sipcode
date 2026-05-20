import { authMw } from '../auth/middleware.js';
import { adminHandler } from './admin.js';
import { handlers } from './handlers.js';
// BUG: admin route mounted BEFORE authMw.
export const routes = [['/admin', adminHandler], ['*', [authMw, handlers]]];
