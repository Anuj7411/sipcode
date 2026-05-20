import { Router } from 'express';
export const users = Router();
users.get('/', (_req, res) => res.json([]));
