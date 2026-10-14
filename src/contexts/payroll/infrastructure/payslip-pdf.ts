import PDFDocument from 'pdfkit';

export interface PayslipDocument {
  company: { name: string; nif: string };
  employee: { name: string; number: string; nif: string | null; socialSecurityNumber: string | null; position: string | null };
  period: string;
  paymentDate: string | null;
  lines: { code: string; description: string; quantity: string | null; amount: string; kind: string }[];
  totals: { gross: string; ssEmployee: string; irt: string; totalDeductions: string; net: string };
  legalTables: string;
}

const kz = (value: string) => `${Number(value).toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

/** Payslip PDF (docs/09: generated server-side; the worker uses the same renderer for bulk sending). */
export function renderPayslipPdf(data: PayslipDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Recibo de vencimento — ${data.employee.name} — ${data.period}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text('Recibo de vencimento');
    doc.fontSize(10).font('Helvetica').fillColor('#475467').text(`${data.company.name} · NIF ${data.company.nif}`);
    doc.text(`Período: ${data.period}${data.paymentDate ? ` · Pagamento: ${data.paymentDate}` : ''}`);
    doc.moveDown();

    doc.fillColor('#101828').font('Helvetica-Bold').text(data.employee.name);
    doc.font('Helvetica').fillColor('#475467').text(
      [`N.º ${data.employee.number}`, data.employee.position, data.employee.nif && `NIF ${data.employee.nif}`, data.employee.socialSecurityNumber && `INSS ${data.employee.socialSecurityNumber}`].filter(Boolean).join(' · '),
    );
    doc.moveDown();

    const section = (title: string, kinds: string[]) => {
      const rows = data.lines.filter((line) => kinds.includes(line.kind));
      if (!rows.length) return;
      doc.font('Helvetica-Bold').fillColor('#101828').fontSize(10).text(title);
      doc.moveDown(0.3);
      for (const line of rows) {
        const y = doc.y;
        doc.font('Helvetica').fillColor('#475467').text(line.code, 48, y, { width: 40 });
        doc.fillColor('#101828').text(line.description + (line.quantity ? ` (${line.quantity})` : ''), 92, y, { width: 300 });
        doc.text(kz(line.amount), 400, y, { width: 147, align: 'right' });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.6);
    };
    section('Remunerações', ['EARNING']);
    section('Descontos', ['DEDUCTION']);

    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#EAECF0').stroke();
    doc.moveDown(0.5);
    const total = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#101828').text(label, 48, y);
      doc.text(kz(value), 400, y, { width: 147, align: 'right' });
      doc.moveDown(0.3);
    };
    total('Total ilíquido', data.totals.gross);
    total('Segurança Social', `-${data.totals.ssEmployee}`);
    total('IRT', `-${data.totals.irt}`);
    total('Total de descontos', `-${data.totals.totalDeductions}`);
    doc.moveDown(0.3);
    total('Líquido a receber', data.totals.net, true);

    doc.moveDown(2).fontSize(8).font('Helvetica').fillColor('#667085').text(`Tabelas legais aplicadas: ${data.legalTables}. Documento processado pelo pagador.ao.`);
    doc.end();
  });
}
