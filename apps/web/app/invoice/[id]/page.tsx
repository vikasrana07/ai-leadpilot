'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { STATE_CODES, fmtDate, inr, type InvoiceDetail, type InvoiceParty } from '@/lib/billing';

function Party({ title, p }: { title: string; p: InvoiceParty }) {
  return (
    <div className="text-[13px]"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <p className="font-semibold">{p.legalName}</p><p className="whitespace-pre-line">{p.address}</p>
      <p>State: {STATE_CODES[p.stateCode] ?? p.stateCode} ({p.stateCode})</p>{p.gstin ? <p>GSTIN: <span className="font-mono">{p.gstin}</span></p> : <p className="text-neutral-500">GSTIN: not provided</p>}
    </div>
  );
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/billing/invoices/${id}`), retry: false });
  const unauth = q.error instanceof ApiError && q.error.status === 401;
  useEffect(() => { if (unauth) router.replace(`/login?next=${encodeURIComponent(`/invoice/${id}`)}`); }, [unauth, router, id]);
  if (q.isPending || unauth) return <p className="p-8 text-sm">Loading invoice…</p>;
  if (q.isError) return <p className="p-8 text-sm">{q.error instanceof ApiError && q.error.status === 404 ? 'Invoice not found.' : 'Could not load this invoice.'}</p>;
  const i = q.data;
  const intra = i.igstMinor === 0;
  const half = i.gstRatePercent / 2;
  return (
    <div className="min-h-dvh bg-neutral-100 p-4 print:bg-white print:p-0">
      <style>{'@media print { @page { margin: 14mm } }'}</style>
      <div className="mx-auto mb-3 flex max-w-3xl justify-end print:hidden"><Button variant="primary" onClick={() => window.print()}>Print / Save as PDF</Button></div>
      <article className="mx-auto max-w-3xl rounded-lg bg-white p-8 text-neutral-900 shadow-sm print:rounded-none print:shadow-none">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
          <div><h1 className="text-xl font-bold">Tax Invoice</h1><p className="text-[13px] text-neutral-500">Original for recipient</p></div>
          <div className="text-right text-[13px]"><p>Invoice no: <span className="font-mono font-semibold">{i.number}</span></p><p>Date: {fmtDate(i.issuedAt)}</p>{i.paymentId ? <p>Payment ref: <span className="font-mono">{i.paymentId}</span></p> : null}</div>
        </header>
        <section className="mb-6 grid gap-6 sm:grid-cols-2"><Party title="Supplier" p={i.seller} /><Party title="Billed to" p={i.buyer} /></section>
        <p className="mb-2 text-[13px]">Place of supply: <strong>{i.placeOfSupply}</strong> · SAC: <strong>{i.sac}</strong></p>
        <table className="mb-4 w-full text-[13px]"><thead><tr className="border-y border-neutral-300 text-left"><th className="py-2">Description</th><th className="py-2 text-right">Taxable value</th></tr></thead>
          <tbody><tr className="border-b border-neutral-200"><td className="py-2">{i.description}{i.periodStart && i.periodEnd ? <span className="block text-neutral-500">Period: {fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</span> : null}</td><td className="py-2 text-right">{inr(i.taxableMinor)}</td></tr></tbody></table>
        <table className="ml-auto mb-6 w-full max-w-xs text-[13px]"><tbody>
          <tr><td className="py-1">Taxable value</td><td className="py-1 text-right">{inr(i.taxableMinor)}</td></tr>
          {intra ? <><tr><td className="py-1">CGST @ {half}%</td><td className="py-1 text-right">{inr(i.cgstMinor)}</td></tr><tr><td className="py-1">SGST @ {half}%</td><td className="py-1 text-right">{inr(i.sgstMinor)}</td></tr></> : <tr><td className="py-1">IGST @ {i.gstRatePercent}%</td><td className="py-1 text-right">{inr(i.igstMinor)}</td></tr>}
          <tr className="border-t border-neutral-300 font-semibold"><td className="py-2">Total</td><td className="py-2 text-right">{inr(i.totalMinor)}</td></tr>
        </tbody></table>
        <p className="text-[11px] text-neutral-500">This is a computer-generated invoice. Amounts in Indian rupees. Paid in full.</p>
      </article>
    </div>
  );
}
