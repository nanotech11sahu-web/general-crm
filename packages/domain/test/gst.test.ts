import { describe, expect, it } from 'vitest';
import { amountInWords, financialYear, formatInvoiceNumber, splitGst, validateGstin } from '../src';

describe('GSTIN', () => {
  it('accepts a valid GSTIN and rejects typos, bad state codes and wrong formats', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toEqual({ ok: true, stateCode: '27' }); // Maharashtra
    expect(validateGstin(' 27aapfu0939f1zv ')).toEqual({ ok: true, stateCode: '27' });
    expect(validateGstin('27AAPFU0939F1ZX')).toMatchObject({ ok: false, reason: expect.stringContaining('last character') });
    expect(validateGstin('99AAPFU0939F1ZV')).toMatchObject({ ok: false, reason: expect.stringContaining('state code') });
    expect(validateGstin('hello')).toMatchObject({ ok: false });
    expect(validateGstin('')).toMatchObject({ ok: false });
  });
});

describe('GST split', () => {
  it('intra-state: CGST + SGST halves, odd paisa to SGST, always adds up to the captured amount', () => {
    for (const gross of [118_00, 1299_00 * 3 * 118 / 100, 1, 99_999, 1_234_567]) {
      const g = Math.round(gross); const s = splitGst(g, 18, '27', '27');
      expect(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise).toBe(g); expect(s.igstPaise).toBe(0); expect(s.sgstPaise - s.cgstPaise).toBeLessThanOrEqual(1);
    }
    expect(splitGst(11_800, 18, '27', '27')).toMatchObject({ taxablePaise: 10_000, cgstPaise: 900, sgstPaise: 900, intraState: true });
  });
  it('inter-state: IGST only', () => {
    expect(splitGst(11_800, 18, '27', '29')).toMatchObject({ taxablePaise: 10_000, igstPaise: 1_800, cgstPaise: 0, sgstPaise: 0, intraState: false });
  });
  it('rejects fractional or negative amounts', () => { expect(() => splitGst(10.5, 18, '27', '27')).toThrow(); expect(() => splitGst(-1, 18, '27', '27')).toThrow(); });
});

describe('invoice numbering and words', () => {
  it('financial year runs 1 April to 31 March in IST', () => {
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('2026-27'); // 00:00 on 1 Apr in IST
    expect(financialYear(new Date('2026-03-31T18:29:00Z'))).toBe('2025-26');
    expect(financialYear(new Date('2026-12-15T00:00:00Z'))).toBe('2026-27'); expect(financialYear(new Date('2027-02-01T00:00:00Z'))).toBe('2026-27');
    expect(formatInvoiceNumber('LD', '2026-27', 42)).toBe('LD/2026-27/000042');
  });
  it('writes amounts in Indian words', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only'); expect(amountInWords(11_800)).toBe('Rupees One Hundred Eighteen Only');
    expect(amountInWords(123_456_78)).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only');
    expect(amountInWords(10_000_000_00)).toBe('Rupees One Crore Only');
  });
});
