// v4 sync error handler — needs to become async in v5.
export const mw = (_req, _res, next) => { try { next(); } catch (e) { next(e); } };
