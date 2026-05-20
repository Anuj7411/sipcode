// flaky: timing race
import { auth } from '../src/auth.js';
setTimeout(() => auth(), 1);
