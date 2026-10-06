/** GST helpers for tax invoices (India). Amounts are integer paise so nothing is lost to floating point. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar',
  '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Format + state prefix + the mod-36 check character of the GSTIN scheme. */
export function validateGstin(raw: string): { ok: true; stateCode: string } | { ok: false; reason: string } {
  const g = String(raw ?? '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, reason: 'A GSTIN is 15 characters, like 27AAPFU0939F1ZV' };
  if (!GST_STATE_CODES[g.slice(0, 2)]) return { ok: false, reason: 'The first two digits are not a valid state code' };
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = CHARS.indexOf(g[i]); const p = v * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  if (CHARS[(36 - (sum % 36)) % 36] !== g[14]) return { ok: false, reason: 'The last character does not match: check the GSTIN for a typo' };
  return { ok: true, stateCode: g.slice(0, 2) };
}

export interface GstSplit { grossPaise: number; taxablePaise: number; ratePct: number; cgstPaise: number; sgstPaise: number; igstPaise: number; intraState: boolean }
/**
 * The amount captured by the payment provider is GST-inclusive. Taxable value = gross / (1 + rate); the tax is the remainder, split
 * CGST+SGST (equal halves, odd paisa to SGST) within one state, or IGST between states.
 */
export function splitGst(grossPaise: number, ratePct: number, supplierStateCode: string, placeOfSupplyStateCode: string): GstSplit {
  if (!Number.isInteger(grossPaise) || grossPaise < 0) throw new Error('grossPaise must be a non-negative integer');
  const taxable = Math.round((grossPaise * 100) / (100 + ratePct)); const tax = grossPaise - taxable; const intra = supplierStateCode === placeOfSupplyStateCode;
  const cgst = intra ? Math.floor(tax / 2) : 0;
  return { grossPaise, taxablePaise: taxable, ratePct, cgstPaise: cgst, sgstPaise: intra ? tax - cgst : 0, igstPaise: intra ? 0 : tax, intraState: intra };
}

/** Indian financial year label for a date: 1 Apr 2026 .. 31 Mar 2027 -> "2026-27". Uses IST. */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000); const y = ist.getUTCFullYear(); const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const formatInvoiceNumber = (prefix: string, fy: string, n: number) => `${prefix}/${fy}/${String(n).padStart(6, '0')}`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));
/** "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only" (Indian grouping: thousand, lakh, crore). */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100), p = paise % 100;
  const parts: string[] = []; let n = rupees;
  for (const [div, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) { const q = Math.floor(n / div); if (q) parts.push(`${below100(q) || below1000(q)} ${name}`); n %= div; }
  if (n) parts.push(below1000(n));
  const r = parts.join(' ') || 'Zero';
  return `Rupees ${r}${p ? ` and ${below100(p)} Paise` : ''} Only`;
}
