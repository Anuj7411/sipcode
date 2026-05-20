import { Router } from 'express';
import { users } from './users.js';
import { posts } from './posts.js';
export const router = Router();
router.use('/api/users', users);
router.use('/api/posts', posts);
