import { parse } from './parser.js';
export const print = (s: string) => parse(s).join('|');
