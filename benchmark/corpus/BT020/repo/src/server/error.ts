export const onErr = (err, _req, res, _next) => res.status(500).send(err.message);
