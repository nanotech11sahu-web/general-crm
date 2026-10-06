'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../../../lib/api';

interface Party { legalName?: string; name?: string; gstin?: string; addressLine?: string; address?: string; city?: string; state?: string; postalCode?: string; email?: string; stateCode?: string; sac?: string }
interface Inv { number: string; kind: 'tax_invoice' | 'receipt'; issuedAt: string; paymentId: string; planName: string; seats: number; periodEnd?: string; grossPaise: number; taxablePaise?: number; ratePct?: number; cgstPaise?: number; sgstPaise?: number; igstPaise?: number; intraState?: boolean; placeOfSupplyName?: string; supplier?: Party & { name: string; address: string; sac: string; gstin: string }; customer: Party; amountInWords: string }
const money = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Printable invoice (use the browser's Print → Save as PDF). A "receipt" is shown when the seller's tax details are not configured. */
export default function Invoice() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const [inv, setInv] = useState<Inv | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } try { setInv(await api<Inv>(`/v1/billing/invoices/${id}`)); } catch (e) { setErr(e instanceof ApiError && e.status === 403 ? 'Invoices are for admins and owners.' : 'Invoice not found.'); } })(); }, [id, router]);
  if (err) return <main><p className="err" role="alert">{err}</p></main>;
  if (!inv) return <main><p className="reason">Loading…</p></main>;
  const tax = inv.kind === 'tax_invoice'; const c = inv.customer;
  return (
    <main style={{ maxWidth: 760 }}>
      <div className="bar" data-print="hide"><h1>{tax ? 'Tax invoice' : 'Payment receipt'}</h1><span className="row"><button onClick={() => window.print()}>Print / save as PDF</button><button onClick={() => router.push('/billing')}>Back</button></span></div>
      <section className="card" data-testid="invoice">
        <div className="row" style={{ justifyContent: 'space-between' }}><div><h2>{tax ? 'TAX INVOICE' : 'PAYMENT RECEIPT'}</h2><p className="reason">No. <b data-testid="invoice-number">{inv.number}</b><br />Date {new Date(inv.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}<br />Payment ref {inv.paymentId}</p></div>
          {tax && inv.supplier && <div style={{ textAlign: 'right' }}><b>{inv.supplier.name}</b><br /><span className="reason">{inv.supplier.address}<br />GSTIN {inv.supplier.gstin}</span></div>}</div>
        <h2 style={{ marginTop: 16 }}>Billed to</h2>
        <p className="reason"><b>{c.legalName ?? c.name}</b>{c.addressLine ? <><br />{c.addressLine}, {c.city} {c.postalCode}<br />{c.state}</> : null}{c.gstin ? <><br />GSTIN {c.gstin}</> : null}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}><thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}><th>Description</th>{tax && <th>SAC</th>}<th style={{ textAlign: 'right' }}>{tax ? 'Taxable value' : 'Amount'}</th></tr></thead>
          <tbody><tr><td>LeadDesk {inv.planName} plan · {inv.seats} seat{inv.seats === 1 ? '' : 's'}{inv.periodEnd ? ` · period to ${new Date(inv.periodEnd).toLocaleDateString('en-IN')}` : ''}</td>{tax && <td>{inv.supplier?.sac}</td>}<td style={{ textAlign: 'right' }}>{money(tax ? inv.taxablePaise! : inv.grossPaise)}</td></tr></tbody></table>
        {tax && (<table style={{ width: '100%', marginTop: 12 }}><tbody>
          {inv.intraState ? (<><tr><td>CGST @ {(inv.ratePct! / 2)}%</td><td style={{ textAlign: 'right' }}>{money(inv.cgstPaise!)}</td></tr><tr><td>SGST @ {(inv.ratePct! / 2)}%</td><td style={{ textAlign: 'right' }}>{money(inv.sgstPaise!)}</td></tr></>) : (<tr><td>IGST @ {inv.ratePct}%</td><td style={{ textAlign: 'right' }}>{money(inv.igstPaise!)}</td></tr>)}
          <tr><td className="reason">Place of supply: {inv.placeOfSupplyName}</td><td /></tr></tbody></table>)}
        <p style={{ fontSize: 18, marginTop: 12 }}><b>Total {money(inv.grossPaise)}</b></p><p className="reason">{inv.amountInWords}</p>
        {!tax && <p className="reason">This is a payment receipt. A GST tax invoice is issued once the seller's tax details are set up.</p>}
      </section>
      <style>{`@media print { [data-print="hide"] { display: none } main { max-width: none } body { background: #fff } }`}</style>
    </main>
  );
}
