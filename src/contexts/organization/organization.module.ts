import { Module } from '@nestjs/common';

import { OrganizationService } from './application/organization.service';
import { OrganizationController } from './presentation/organization.controller';
import { CompanyProvisioning } from './public';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, CompanyProvisioning],
  exports: [CompanyProvisioning],
})
export class OrganizationModule {}
