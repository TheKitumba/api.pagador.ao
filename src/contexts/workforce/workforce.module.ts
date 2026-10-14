import { Global, Module } from '@nestjs/common';

import { ContractorInvoicesService } from './application/contractor-invoices.service';
import { ConfirmProbationUseCase, ContractQueries, CreateContractUseCase, RenewContractUseCase } from './application/contracts.use-cases';
import { EmployeeDocumentsService } from './application/documents.service';
import { ChangeBankAccountUseCase, EmployeeQueries, HireEmployeeUseCase, UpdateEmployeeUseCase } from './application/employees.use-cases';
import { ImportEmployeesUseCase } from './application/import-employees.use-case';
import { NotRenewContractUseCase, StartTerminationUseCase, TerminationOutcomeHandler, TerminationQueries } from './application/terminations.use-cases';
import { ContractorInvoicesController, ContractsController, DocumentsController, EmployeesController, TerminationsController } from './presentation/workforce.controller';
import { EmployeeDirectory } from './public';

/** Global: other contexts depend on EmployeeDirectory (public facade). */
@Global()
@Module({
  controllers: [EmployeesController, DocumentsController, ContractsController, TerminationsController, ContractorInvoicesController],
  providers: [
    EmployeeDirectory,
    EmployeeQueries,
    HireEmployeeUseCase,
    UpdateEmployeeUseCase,
    ChangeBankAccountUseCase,
    EmployeeDocumentsService,
    ImportEmployeesUseCase,
    ContractQueries,
    CreateContractUseCase,
    RenewContractUseCase,
    ConfirmProbationUseCase,
    StartTerminationUseCase,
    NotRenewContractUseCase,
    TerminationOutcomeHandler,
    TerminationQueries,
    ContractorInvoicesService,
  ],
  exports: [EmployeeDirectory],
})
export class WorkforceModule {}
