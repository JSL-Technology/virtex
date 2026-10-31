import type { DeliveryNote } from '../entities/delivery-note.entity';
import type { OrganizationFiscalIdentity } from '../../organizations/contracts/fiscal-identity.contract';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function qty(value: number): string {
  return Number(value).toLocaleString('es-DO', { maximumFractionDigits: 6 });
}

/**
 * The conduce as it travels with the goods: who sends, who receives, what, and the block the
 * receiver signs. No prices — a conduce is proof of delivery, not a bill, and the driver should not
 * carry the customer's prices around. Printed from the browser (Ctrl+P); one page per conduce.
 */
export function deliveryNoteHtml(note: DeliveryNote, company: OrganizationFiscalIdentity | null): string {
  const customer = note.customer as unknown as { companyName?: string; taxId?: string | null } | undefined;
  const rows = (note.lines ?? [])
    .map((line, i) => `<tr><td>${i + 1}</td><td>${esc(line.description)}</td><td class="r">${esc(qty(line.quantity))}</td></tr>`)
    .join('');
  const voided = note.status === 'VOIDED' ? `<div class="void">ANULADO — ${esc(note.voidReason)}</div>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Conduce ${esc(note.number)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font: 12px/1.4 system-ui, sans-serif; color: #000; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 16px; margin: 0; text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; } .r { text-align: right; }
  .sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 48px; }
  .sign div { border-top: 1px solid #000; padding-top: 4px; text-align: center; }
  .void { border: 3px solid #000; padding: 6px; text-align: center; font-weight: 700; margin: 8px 0; }
</style></head><body>
<header>
  <div><h1>${esc(company?.legalName)}</h1><div>RNC ${esc(company?.taxId)}</div><div>${esc([company?.address, company?.city].filter(Boolean).join(', '))}</div></div>
  <div><h2>CONDUCE ${esc(note.number)}</h2><div class="r">Fecha: ${esc(note.deliveryDate)}</div><div class="r">Pedido: ${esc(note.order?.orderNumber)}</div>${note.order?.customerReference ? `<div class="r">Orden del cliente: ${esc(note.order.customerReference)}</div>` : ''}</div>
</header>
${voided}
<div class="grid">
  <div><strong>Cliente:</strong> ${esc(customer?.companyName)}${customer?.taxId ? ` — RNC/Cédula ${esc(customer.taxId)}` : ''}</div>
  <div><strong>Dirección de entrega:</strong> ${esc(note.deliveryAddress)}</div>
  <div><strong>Chofer:</strong> ${esc(note.driverName)}</div>
  <div><strong>Vehículo (placa):</strong> ${esc(note.vehiclePlate)}</div>
</div>
<table><thead><tr><th>#</th><th>Descripción</th><th class="r">Cantidad</th></tr></thead><tbody>${rows}</tbody></table>
${note.notes ? `<p><strong>Notas:</strong> ${esc(note.notes)}</p>` : ''}
<div class="sign"><div>Despachado por</div><div>Transportado por</div><div>Recibido conforme${note.receivedBy ? `: ${esc(note.receivedBy)}` : ''}<br>Nombre, cédula y firma</div></div>
</body></html>`;
}
