// flaky: shared state leak
import { inc } from '../src/inventory.js';
console.log(inc());
