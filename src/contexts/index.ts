import { AnalyticsModule } from './analytics/analytics.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { CommunicationModule } from './communication/communication.module';
import { EmployeeRelationsModule } from './employee-relations/employee-relations.module';
import { IdentityAccessModule } from './identity-access/identity-access.module';
import { OrganizationModule } from './organization/organization.module';
import { PaymentsModule } from './payments/payments.module';
import { PayrollModule } from './payroll/payroll.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { TalentModule } from './talent/talent.module';
import { TaxComplianceModule } from './tax-compliance/tax-compliance.module';
import { TimeModule } from './time/time.module';
import { WorkforceModule } from './workforce/workforce.module';

/** Bounded contexts (docs/09, 9.4.1) mounted on the shared infrastructure. */
export const CONTEXT_MODULES = [
  IdentityAccessModule,
  OrganizationModule,
  WorkforceModule,
  TimeModule,
  ApprovalsModule,
  PayrollModule,
  PaymentsModule,
  TaxComplianceModule,
  RecruitmentModule,
  TalentModule,
  EmployeeRelationsModule,
  CommunicationModule,
  AnalyticsModule,
  AuditModule,
];
