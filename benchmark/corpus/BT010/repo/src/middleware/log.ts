import { makeSpan } from '../tracing/span.js';
export function log() { const s = makeSpan(); console.log(s.id); }
