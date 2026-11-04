import { describe, expect, it } from 'vitest';
import { fold, foldKeep } from '../src/lib/model/format';

describe('foldKeep', () => {
  it('quita tildes y mayúsculas conservando el largo', () => {
    const s = 'Ñuñoa, Peñalolén — ÁNGEL Müller';
    expect(foldKeep(s)).toBe('nunoa, penalolen — angel muller');
    expect(foldKeep(s)).toHaveLength(s.length);
  });
  it('coincide con fold en texto común', () => {
    expect(foldKeep('José María Pérez')).toBe(fold('José María Pérez'));
  });
});
