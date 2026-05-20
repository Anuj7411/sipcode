import { describe, it, expect } from 'vitest';
import { feature } from './feature.js';
describe('feature', () => { it('returns matches', () => expect(feature([{ id: 1 }])).toHaveLength(1)); });
