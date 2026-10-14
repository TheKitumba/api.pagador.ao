import { Global, Module } from '@nestjs/common';

import { BenefitsService, ExpensesService, LoansService } from './application/compensation.use-cases';
import { PayrollConfigService } from './application/payroll-config.service';
import * as runs from './application/payroll-runs.use-cases';
import { PayslipsService } from './application/payslips.service';
import { AttendanceSummaryPort, EmploymentSnapshotPort } from './application/ports';
import { AttendanceSummaryAdapter, EmploymentSnapshotAdapter } from './infrastructure/adapters';
import { LegalParametersProvider } from './infrastructure/legal-parameters.provider';
import { CompensationController, PayrollConfigController, PayrollRunsController, PayslipsController } from './presentation/payroll.controller';
import { LoanBalances, PayrollProvisioning, PayrollRunsFacade } from './public';

/** Global: payments, tax-compliance and workforce use the public facades. */
@Global()
@Module({
  controllers: [PayrollRunsController, PayslipsController, PayrollConfigController, CompensationController],
  providers: [
    LegalParametersProvider,
    { provide: EmploymentSnapshotPort, useClass: EmploymentSnapshotAdapter },
    { provide: AttendanceSummaryPort, useClass: AttendanceSummaryAdapter },
    runs.PayrollRunRepository,
    runs.CreatePayrollRunUseCase,
    runs.PayrollRunCalculation,
    runs.CalculatePayrollRunUseCase,
    runs.SubmitPayrollRunUseCase,
    runs.PayrollRunOutcomeHandler,
    runs.ClosePayrollRunUseCase,
    runs.PayrollVariablesService,
    runs.PayrollRunQueries,
    PayslipsService,
    PayrollConfigService,
    LoansService,
    ExpensesService,
    BenefitsService,
    PayrollProvisioning,
    LoanBalances,
    PayrollRunsFacade,
  ],
  exports: [PayrollProvisioning, LoanBalances, PayrollRunsFacade, runs.PayrollRunCalculation, PayslipsService],
})
export class PayrollModule {}
