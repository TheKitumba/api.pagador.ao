import { Module } from '@nestjs/common';

import { PerformanceService, TrainingService } from './application/talent.service';
import { PerformanceController, TrainingController } from './presentation/talent.controller';

@Module({ controllers: [PerformanceController, TrainingController], providers: [PerformanceService, TrainingService] })
export class TalentModule {}

