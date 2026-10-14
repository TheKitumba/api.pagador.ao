import { Module } from '@nestjs/common';

import { RecruitmentService } from './application/recruitment.service';
import { RecruitmentController, CareersController } from './presentation/recruitment.controller';

@Module({ controllers: [RecruitmentController, CareersController], providers: [RecruitmentService] })
export class RecruitmentModule {}
