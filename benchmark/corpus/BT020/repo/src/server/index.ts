import express from 'express';
const app = express();
app.get('/', (req, res) => res.json({ p: req.param('p') }));
export { app };
