import { Module } from '@nestjs/common';

import { DisciplinaryService, SafetyService } from './application/employee-relations.service';
import { EmployeeRelationsController } from './presentation/employee-relations.controller';

@Module({ controllers: [EmployeeRelationsController], providers: [DisciplinaryService, SafetyService] })
export class EmployeeRelationsModule {}
