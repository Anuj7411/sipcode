// BUG: skipped for /admin in router.ts.
export const authMw = (req, _res, next) => { if (!req.headers.authorization) return next(new Error('no auth')); next(); };
