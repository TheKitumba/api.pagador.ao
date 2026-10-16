import './load-env';

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { LegalTableKind, Prisma, Role } from '@prisma/client';
import { ClsModule, ClsService } from 'nestjs-cls';

import { CONTEXT_MODULES } from './contexts';
import { RegisterAccountUseCase } from './contexts/identity-access/application/auth.use-cases';
import { PasswordHasher } from './contexts/identity-access/infrastructure/credentials';
import { OrganizationService } from './contexts/organization/application/organization.service';
import { HireEmployeeUseCase } from './contexts/workforce/application/employees.use-cases';
import { permissionsFor } from './shared/application/permissions';
import { ActorContext } from './shared/infrastructure/context/actor-context';
import { Database } from './shared/infrastructure/prisma/database';
import { PrismaService } from './shared/infrastructure/prisma/prisma.service';
import { SharedInfrastructureModule } from './shared/infrastructure/shared-infrastructure.module';

/**
 * Seeds reference data (banks, provinces, global legal tables) and, unless SEED_DEMO=false, a
 * demo company built through the real use cases, so it obeys the same rules as user data.
 * Idempotent: running it again changes nothing.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Pagador#2026';
const log = new Logger('Seed');

const BANKS = [
  { code: '0010', name: 'Banco de Poupança e Crédito (BPC)', swift: 'BPCLAOLU' },
  { code: '0006', name: 'Banco de Fomento Angola (BFA)', swift: 'BFMXAOLU' },
  { code: '0040', name: 'Banco Angolano de Investimentos (BAI)', swift: 'BAIPAOLU' },
  { code: '0051', name: 'Banco BIC', swift: 'BINFAOLU' },
  { code: '0055', name: 'Banco Millennium Atlântico', swift: 'PRTLAOLU' },
  { code: '0060', name: 'Standard Bank Angola', swift: 'SBICAOLU' },
  { code: '0044', name: 'Banco Sol', swift: 'SOLOAOLU' },
  { code: '0047', name: 'Banco Keve', swift: 'KEVEAOLU' },
  { code: '0045', name: 'Banco Económico', swift: 'ESANAOLU' },
  { code: '0066', name: 'Banco Yetu', swift: null },
  { code: '0004', name: 'Banco Caixa Geral Angola', swift: 'CGDIAOLU' },
].map((bank) => ({ ...bank, fileFormat: 'PS2' }));

const PROVINCES: Record<string, string[]> = {
  Bengo: ['Dande', 'Ambriz', 'Nambuangongo'],
  Benguela: ['Benguela', 'Lobito', 'Catumbela', 'Baía Farta', 'Cubal'],
  Bié: ['Cuíto', 'Andulo', 'Camacupa'],
  Cabinda: ['Cabinda', 'Cacongo', 'Buco-Zau'],
  'Cuando Cubango': ['Menongue', 'Cuito Cuanavale'],
  'Cuanza Norte': ['Cazengo', 'Cambambe'],
  'Cuanza Sul': ['Sumbe', 'Porto Amboim', 'Gabela'],
  Cunene: ['Ondjiva', 'Cuanhama'],
  Huambo: ['Huambo', 'Caála', 'Bailundo'],
  Huíla: ['Lubango', 'Matala', 'Chibia'],
  Luanda: ['Luanda', 'Belas', 'Talatona', 'Viana', 'Cacuaco', 'Cazenga', 'Kilamba Kiaxi'],
  'Lunda Norte': ['Dundo', 'Cuango'],
  'Lunda Sul': ['Saurimo', 'Muconda'],
  Malanje: ['Malanje', 'Cacuso'],
  Moxico: ['Luena', 'Luau'],
  Namibe: ['Moçâmedes', 'Tômbwa'],
  Uíge: ['Uíge', 'Negage'],
  Zaire: ['Mbanza Kongo', 'Soyo'],
  'Icolo e Bengo': ['Catete', 'Icolo e Bengo'],
  'Cuando': ['Mavinga'],
  'Moxico Leste': ['Cazombo'],
};

/** IRT Group A (docs/02, 2.3.3): [from, to, fixed, rate, excessOver]. */
const IRT_BRACKETS: [number, number | null, number, number, number][] = [
  [0, 100_000, 0, 0, 0],
  [100_000, 150_000, 0, 0.13, 100_000],
  [150_000, 200_000, 12_500, 0.16, 150_000],
  [200_000, 300_000, 31_250, 0.18, 200_000],
  [300_000, 500_000, 49_250, 0.19, 300_000],
  [500_000, 1_000_000, 87_250, 0.2, 500_000],
  [1_000_000, 1_500_000, 187_249, 0.21, 1_000_000],
  [1_500_000, 2_000_000, 292_249, 0.22, 1_500_000],
  [2_000_000, 2_500_000, 402_249, 0.23, 2_000_000],
  [2_500_000, 5_000_000, 517_249, 0.24, 2_500_000],
  [5_000_000, 10_000_000, 1_117_249, 0.245, 5_000_000],
  [10_000_000, null, 2_342_248, 0.25, 10_000_000],
];

/** Lei n.º 11/18; Carnaval and Good Friday are movable (Easter 2026: 5 April). */
const HOLIDAYS_2026 = [
  ['2026-01-01', 'Dia do Ano Novo'],
  ['2026-02-04', 'Dia do Início da Luta Armada de Libertação Nacional'],
  ['2026-02-17', 'Carnaval'],
  ['2026-03-08', 'Dia Internacional da Mulher'],
  ['2026-03-23', 'Dia da Libertação da África Austral'],
  ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-04', 'Dia da Paz e da Reconciliação Nacional'],
  ['2026-05-01', 'Dia Internacional do Trabalhador'],
  ['2026-09-17', 'Dia do Fundador da Nação e do Herói Nacional'],
  ['2026-11-02', 'Dia dos Finados'],
  ['2026-11-11', 'Dia da Independência Nacional'],
  ['2026-12-25', 'Dia de Natal e da Família'],
].map(([date, name]) => ({ date, name }));

const LEGAL_TABLES: { kind: LegalTableKind; version: string; effectiveFrom: string; legalReference: string; data: Prisma.InputJsonValue }[] = [
  {
    kind: 'IRT_GROUP_A',
    version: 'IRT Grupo A 2026',
    effectiveFrom: '2020-09-01',
    legalReference: 'Código do IRT (Lei n.º 28/20), tabela do Grupo A',
    data: { brackets: IRT_BRACKETS.map(([from, to, fixed, rate, excessOver]) => ({ from, to, fixed, rate, excessOver })) },
  },
  { kind: 'SOCIAL_SECURITY', version: 'INSS 3% + 8%', effectiveFrom: '2004-01-01', legalReference: 'Lei n.º 7/04 e Decreto n.º 227/18', data: { employeeRate: 0.03, employerRate: 0.08 } },
  { kind: 'OVERTIME_RATES', version: 'LGT 2023', effectiveFrom: '2023-09-12', legalReference: 'Lei Geral do Trabalho (Lei n.º 12/23)', data: { weekday: 1.5, restDay: 2, holiday: 2, night: 1.25, monthlyLimitHours: 30, annualLimitHours: 200 } },
  { kind: 'MINIMUM_WAGE', version: 'SMN 2024', effectiveFrom: '2024-09-01', legalReference: 'Decreto Presidencial n.º 152/24 (confirmar valor em vigor)', data: { amount: 70_000 } },
  { kind: 'HOLIDAYS', version: 'Feriados 2026', effectiveFrom: '2026-01-01', legalReference: 'Lei n.º 11/18', data: { holidays: HOLIDAYS_2026 } },
  { kind: 'CONTRACTOR_WITHHOLDING', version: 'Retenção 6,5%', effectiveFrom: '2020-01-01', legalReference: 'Código do Imposto Industrial (retenção na fonte sobre prestações de serviços)', data: { rate: 0.065 } },
];

const DEPARTMENTS = [
  { name: 'Operações', costCenter: 'CC-100' },
  { name: 'Logística e Armazém', costCenter: 'CC-200' },
  { name: 'Finanças', costCenter: 'CC-300' },
  { name: 'Recursos Humanos', costCenter: 'CC-400' },
  { name: 'Comercial', costCenter: 'CC-500' },
  { name: 'Tecnologia', costCenter: 'CC-600' },
];

const SITES = [
  { key: 'sede', name: 'Sede — Talatona, Luanda', province: 'Luanda' },
  { key: 'lobito', name: 'Armazém do Lobito, Benguela', province: 'Benguela' },
  { key: 'huambo', name: 'Delegação do Huambo', province: 'Huambo' },
];

interface DemoEmployee {
  name: string;
  position: string;
  department: string;
  site: string;
  manager: string | null;
  contract: 'INDEFINITE' | 'FIXED_TERM';
  hireDate: string;
  salary: number;
  bank: string;
  birthDate: string;
  gender: 'FEMALE' | 'MALE';
  idNumber: string;
  phone: string;
  /** Login for this employee, with these roles (beyond EMPLOYEE). */
  roles?: Role[];
}

/** Same people as the web app's fixtures (frontend/src/mocks/people.ts); managers first. */
const EMPLOYEES: DemoEmployee[] = [
  { name: 'Domingos Cassoma', position: 'Director de Operações', department: 'Operações', site: 'sede', manager: null, contract: 'INDEFINITE', hireDate: '2015-01-12', salary: 1_450_000, bank: '0040', birthDate: '1979-04-02', gender: 'MALE', idNumber: '001233498LA032', phone: '912334120', roles: ['LINE_MANAGER'] },
  { name: 'Graça Mbemba', position: 'Directora Financeira', department: 'Finanças', site: 'sede', manager: null, contract: 'INDEFINITE', hireDate: '2016-09-01', salary: 1_380_000, bank: '0060', birthDate: '1981-02-14', gender: 'FEMALE', idNumber: '001876543LA028', phone: '912009871', roles: ['FINANCIAL_APPROVER', 'LINE_MANAGER'] },
  { name: 'Isabel Neto', position: 'Gestora de Recursos Humanos', department: 'Recursos Humanos', site: 'sede', manager: null, contract: 'INDEFINITE', hireDate: '2017-02-06', salary: 1_150_000, bank: '0006', birthDate: '1983-08-27', gender: 'FEMALE', idNumber: '002345678LA030', phone: '923100200', roles: ['HR_MANAGER', 'LINE_MANAGER'] },
  { name: 'Kátia Sebastião', position: 'Directora Comercial', department: 'Comercial', site: 'sede', manager: null, contract: 'INDEFINITE', hireDate: '2018-04-09', salary: 1_250_000, bank: '0006', birthDate: '1986-12-03', gender: 'FEMALE', idNumber: '003345671LA036', phone: '923667902', roles: ['LINE_MANAGER'] },
  { name: 'Osvaldo Chipenda', position: 'Responsável de Sistemas', department: 'Tecnologia', site: 'sede', manager: null, contract: 'INDEFINITE', hireDate: '2019-10-01', salary: 1_100_000, bank: '0040', birthDate: '1987-05-11', gender: 'MALE', idNumber: '004009876LA039', phone: '927556340' },
  { name: 'Feliciano Lukamba', position: 'Chefe de Armazém', department: 'Logística e Armazém', site: 'lobito', manager: 'Domingos Cassoma', contract: 'INDEFINITE', hireDate: '2017-05-22', salary: 780_000, bank: '0006', birthDate: '1984-11-30', gender: 'MALE', idNumber: '002198776BG012', phone: '923778410', roles: ['LINE_MANAGER'] },
  { name: 'Ana Mateus', position: 'Técnica de Contabilidade', department: 'Finanças', site: 'sede', manager: 'Graça Mbemba', contract: 'INDEFINITE', hireDate: '2019-03-04', salary: 300_000, bank: '0006', birthDate: '1991-10-16', gender: 'FEMALE', idNumber: '004512378LA041', phone: '923456781', roles: ['PAYROLL_PROCESSOR'] },
  { name: 'Edvânia Tavares', position: 'Analista de Recursos Humanos', department: 'Recursos Humanos', site: 'sede', manager: 'Isabel Neto', contract: 'FIXED_TERM', hireDate: '2026-08-03', salary: 420_000, bank: '0051', birthDate: '1997-06-21', gender: 'FEMALE', idNumber: '006781234LA045', phone: '934210554', roles: ['HR_TECHNICIAN'] },
  { name: 'Hélder Kiala', position: 'Motorista de Pesados', department: 'Operações', site: 'lobito', manager: 'Feliciano Lukamba', contract: 'INDEFINITE', hireDate: '2020-02-17', salary: 260_000, bank: '0040', birthDate: '1988-07-08', gender: 'MALE', idNumber: '005543219BG019', phone: '945120337' },
  { name: 'Lukeny Bamba', position: 'Operador de Empilhadora', department: 'Logística e Armazém', site: 'lobito', manager: 'Feliciano Lukamba', contract: 'FIXED_TERM', hireDate: '2025-11-03', salary: 210_000, bank: '0051', birthDate: '1999-03-19', gender: 'MALE', idNumber: '007765412BG022', phone: '931445216' },
  { name: 'Manuel Kalandula', position: 'Técnico de Manutenção', department: 'Operações', site: 'huambo', manager: 'Domingos Cassoma', contract: 'INDEFINITE', hireDate: '2021-07-05', salary: 350_000, bank: '0044', birthDate: '1990-09-25', gender: 'MALE', idNumber: '005098712HB011', phone: '924880113' },
  { name: 'Nádia Paím', position: 'Gestora de Clientes', department: 'Comercial', site: 'sede', manager: 'Kátia Sebastião', contract: 'INDEFINITE', hireDate: '2022-02-14', salary: 480_000, bank: '0006', birthDate: '1994-10-20', gender: 'FEMALE', idNumber: '006123987LA044', phone: '913220678' },
  { name: 'Rui Kapinga', position: 'Assistente Administrativo', department: 'Recursos Humanos', site: 'sede', manager: 'Isabel Neto', contract: 'FIXED_TERM', hireDate: '2024-03-18', salary: 230_000, bank: '0006', birthDate: '1996-01-09', gender: 'MALE', idNumber: '007001234LA047', phone: '935101772' },
];

/** A valid Angolan IBAN (mod-97 check digits) for a bank code and a 17-digit account. */
function ibanFor(bankCode: string, account: string) {
  const bban = `${bankCode}${account.padStart(17, '0')}`;
  const numeric = `${bban}${'A'.charCodeAt(0) - 55}${'O'.charCodeAt(0) - 55}00`;
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return `AO${String(98 - remainder).padStart(2, '0')}${bban}`;
}

/** First yearly anniversary of the hire date still in the future (current fixed-term contract end). */
function nextAnniversary(hireDate: string) {
  const today = new Date().toISOString().slice(0, 10);
  let year = Number(hireDate.slice(0, 4)) + 1;
  while (`${year}${hireDate.slice(4)}` <= today) year += 1;
  return `${year}${hireDate.slice(4)}`;
}

function emailFor(name: string) {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return `${ascii.split(' ').join('.')}@kianda.co.ao`;
}

async function seedReferenceData(prisma: PrismaService) {
  for (const bank of BANKS) await prisma.bank.upsert({ where: { code: bank.code }, create: bank, update: bank });
  for (const [name, municipalities] of Object.entries(PROVINCES)) await prisma.province.upsert({ where: { name }, create: { name, municipalities }, update: { municipalities } });
  for (const table of LEGAL_TABLES) {
    const exists = await prisma.legalTable.findFirst({ where: { tenantId: null, kind: table.kind, version: table.version } });
    if (exists) continue;
    await prisma.legalTable.create({ data: { ...table, effectiveFrom: new Date(`${table.effectiveFrom}T00:00:00Z`), approvedBy: 'pagador.ao', approvedAt: new Date() } });
  }
  log.log(`Referência: ${BANKS.length} bancos, ${Object.keys(PROVINCES).length} províncias, ${LEGAL_TABLES.length} tabelas legais`);
}

async function seedDemoCompany(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const prisma = app.get(PrismaService);
  const ownerEmail = 'admin@kianda.co.ao';
  if (await prisma.user.findUnique({ where: { email: ownerEmail } })) {
    log.log('Empresa de demonstração já existe');
    return;
  }

  const session = await app.get(RegisterAccountUseCase).execute(
    { name: 'Administrador Kianda', email: ownerEmail, password: DEMO_PASSWORD, company: { name: 'Kianda Logística, Lda.', nif: '5417089621', size: '201–500 trabalhadores', province: 'Luanda' } },
    { ip: '127.0.0.1', userAgent: 'seed' },
  );
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId: session.user.id } });
  const tenantId = membership.tenantId;
  const companyId = membership.companyId!;

  const cls = app.get(ClsService);
  const db = app.get(Database);
  const actors = app.get(ActorContext);
  const organization = app.get(OrganizationService);
  const hire = app.get(HireEmployeeUseCase);
  const hasher = app.get(PasswordHasher);
  const passwordHash = await hasher.hash(DEMO_PASSWORD);

  await cls.run(() =>
    db.runAsTenant(tenantId, async (tx) => {
      const roles: Role[] = ['ACCOUNT_ADMIN', 'HR_MANAGER', 'PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'];
      actors.set({ userId: session.user.id, tenantId, companyId, employeeId: null, name: 'Administrador Kianda', roles, permissions: permissionsFor(roles) });

      // A second company in the group, to show switching between companies (POST /v1/auth/company).
      const port = await tx.company.create({
        data: { tenantId, legalName: 'Kianda Serviços Portuários, S.A.', tradeName: 'Kianda Portuária', nif: '5000348812', sizeClass: 'MEDIUM', province: 'Benguela', careersSlug: 'kianda-portuaria' },
      });
      await tx.establishment.create({ data: { tenantId, companyId: port.id, name: 'Terminal do Lobito', province: 'Benguela' } });

      const sites = new Map<string, string>();
      for (const site of SITES) sites.set(site.key, (await organization.createEstablishment({ name: site.name, province: site.province })).id);

      const units = new Map<string, string>();
      for (const department of DEPARTMENTS) {
        const costCenter = await organization.createCostCenter({ code: department.costCenter, name: department.name });
        units.set(department.name, (await organization.createOrgUnit({ name: department.name, kind: 'DEPARTMENT', costCenterId: costCenter.id })).id);
      }

      const people = new Map<string, string>();
      for (const [index, person] of EMPLOYEES.entries()) {
        const orgUnitId = units.get(person.department);
        const position = await organization.createPosition({ title: person.position, orgUnitId });
        const hireDate = person.hireDate;
        const endDate = person.contract === 'FIXED_TERM' ? nextAnniversary(hireDate) : undefined;
        const { id } = await hire.execute({
          fullName: person.name,
          birthDate: person.birthDate,
          gender: person.gender,
          idDocumentNumber: person.idNumber,
          nif: person.idNumber,
          socialSecurityNumber: String(10_000_000 + index * 7919),
          phone: `+244${person.phone}`,
          email: emailFor(person.name),
          province: SITES.find((site) => site.key === person.site)?.province,
          hireDate,
          positionId: position.id,
          orgUnitId,
          establishmentId: sites.get(person.site),
          managerId: person.manager ? people.get(person.manager) : undefined,
          contract: { type: person.contract, endDate, baseSalary: person.salary },
          bank: { bankCode: person.bank, iban: ibanFor(person.bank, `${4512378 + index * 1013}${String(index).padStart(4, '0')}`) },
        });
        people.set(person.name, id);

        if (person.roles) {
          const user = await tx.user.create({ data: { name: person.name, email: emailFor(person.name), passwordHash } });
          await tx.membership.create({ data: { tenantId, userId: user.id, companyId, employeeId: id, roles: ['EMPLOYEE', ...person.roles] } });
        }
      }

      for (const department of DEPARTMENTS) {
        const head = EMPLOYEES.find((person) => person.department === department.name && !person.manager) ?? EMPLOYEES.find((person) => person.department === department.name);
        if (head) await tx.orgUnit.update({ where: { id: units.get(department.name)! }, data: { headEmployeeId: people.get(head.name) } });
      }
    }),
  );

  log.log(`Empresa de demonstração criada: ${EMPLOYEES.length} colaboradores. Entrar com ${ownerEmail} ou isabel.neto@kianda.co.ao / ${DEMO_PASSWORD}`);
}

/** The contexts without HTTP nor queue processors. */
@Module({ imports: [ClsModule.forRoot({ global: true }), JwtModule.register({ global: true }), SharedInfrastructureModule, ...CONTEXT_MODULES] })
class SeedModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn', 'log'] });
  try {
    await seedReferenceData(app.get(PrismaService));
    if (process.env.SEED_DEMO !== 'false') await seedDemoCompany(app);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  log.error(error);
  process.exit(1);
});
