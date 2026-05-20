import { Router } from 'express';
export const posts = Router();
posts.get('/', (_req, res) => res.json([]));
