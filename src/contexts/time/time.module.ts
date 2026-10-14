import { Global, Module } from '@nestjs/common';

import * as attendance from './application/attendance.use-cases';
import * as leave from './application/leave.use-cases';
import * as requests from './application/requests.use-cases';
import { TimeSupport } from './application/time-support';
import { AttendanceController, LeaveController, OvertimeController, SchedulesController, TimesheetsController } from './presentation/time.controller';
import { AttendanceFacade, LeaveBalances } from './public';

/** Global: workforce (final settlement) and payroll use the public facades. */
@Global()
@Module({
  controllers: [AttendanceController, LeaveController, OvertimeController, TimesheetsController, SchedulesController],
  providers: [
    TimeSupport,
    LeaveBalances,
    AttendanceFacade,
    attendance.PunchUseCase,
    attendance.ImportPunchesUseCase,
    attendance.AttendanceQueries,
    attendance.RequestCorrectionUseCase,
    attendance.CorrectionOutcomeHandler,
    attendance.CloseAttendancePeriodUseCase,
    leave.RequestLeaveUseCase,
    leave.LeaveOutcomeHandler,
    leave.CancelLeaveUseCase,
    leave.LeaveQueries,
    leave.AdjustLeaveBalanceUseCase,
    requests.RequestOvertimeUseCase,
    requests.RegisterTimesheetUseCase,
    requests.TimeRequestOutcomeHandlers,
    requests.TimeRequestQueries,
    requests.SchedulesService,
  ],
  exports: [LeaveBalances, AttendanceFacade],
})
export class TimeModule {}
