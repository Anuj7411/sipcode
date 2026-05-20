import { describe, it, expect } from 'vitest';
import { today } from '../src/dates.js';
describe('today', () => { it('returns yyyy-mm-dd', () => expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)); });
