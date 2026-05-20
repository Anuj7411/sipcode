import { scheduleJob } from '../../workers/src/queue.js';
export const dispatcher = { run: (j) => scheduleJob(j) };
