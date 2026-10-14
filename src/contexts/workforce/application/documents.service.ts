import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { authorize } from '@/shared/application/permissions';
import { FileStorage } from '@/shared/application/ports';
import { NotFoundError, ValidationError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { toDate } from '@/shared/application/formatting';

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Employee documents (BI, contracts, certificates…) stored in MinIO; served only through the API. */
@Injectable()
export class EmployeeDocumentsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
  ) {}

  async upload(employeeId: string, file: UploadedFile | undefined, input: { category: string; expiresAt?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'employees.write');
    if (!file) throw new ValidationError('Ficheiro em falta', { file: ['Obrigatório'] });
    if (!ALLOWED.includes(file.mimetype)) throw new ValidationError('Tipo de ficheiro não suportado', { file: ['PDF, JPG, PNG ou WEBP'] });
    if (file.size > MAX_BYTES) throw new ValidationError('Ficheiro demasiado grande', { file: ['Até 10 MB'] });
    const employee = await this.db.tx.employee.findFirst({ where: { id: employeeId, companyId: actor.companyId } });
    if (!employee) throw new NotFoundError('Trabalhador', employeeId);

    const key = `${actor.tenantId}/employees/${employeeId}/${randomUUID()}-${file.originalname.replace(/[^\w.-]+/g, '_')}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const document = await this.db.tx.employeeDocument.create({
      data: {
        tenantId: actor.tenantId,
        employeeId,
        category: input.category,
        fileName: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        storageKey: key,
        expiresAt: input.expiresAt ? toDate(input.expiresAt) : null,
        uploadedBy: actor.userId,
      },
    });
    await this.audit.record({ action: 'employee_document.upload', entityType: 'employee', entityId: employeeId, after: { fileName: file.originalname, category: input.category } });
    return { id: document.id, fileName: document.fileName, category: document.category, size: document.size };
  }

  async download(documentId: string) {
    const actor = this.actors.current;
    authorize(actor, 'employees.read');
    const document = await this.db.tx.employeeDocument.findFirst({ where: { id: documentId, employee: { companyId: actor.companyId } } });
    if (!document) throw new NotFoundError('Documento', documentId);
    const object = await this.storage.get(document.storageKey);
    return { ...object, fileName: document.fileName };
  }

  async remove(documentId: string) {
    const actor = this.actors.current;
    authorize(actor, 'employees.write');
    const document = await this.db.tx.employeeDocument.findFirst({ where: { id: documentId, employee: { companyId: actor.companyId } } });
    if (!document) throw new NotFoundError('Documento', documentId);
    await this.db.tx.employeeDocument.delete({ where: { id: documentId } });
    await this.storage.remove(document.storageKey);
    await this.audit.record({ action: 'employee_document.delete', entityType: 'employee', entityId: document.employeeId, before: { fileName: document.fileName } });
  }
}
