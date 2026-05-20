import { walk } from '../legacy/walker.js';
import { print } from '../legacy/printer.js';
import { helper } from '../legacy/helpers.js';
export const api = () => print(String(walk(1))) + helper();
