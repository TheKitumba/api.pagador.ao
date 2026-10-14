-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('ACCOUNT_ADMIN', 'HR_MANAGER', 'HR_TECHNICIAN', 'PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER', 'LINE_MANAGER', 'RECRUITER', 'EMPLOYEE', 'AUDITOR');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."OtpPurpose" AS ENUM ('LOGIN', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "public"."LegalTableKind" AS ENUM ('IRT_GROUP_A', 'SOCIAL_SECURITY', 'MINIMUM_WAGE', 'IRT_EXEMPTIONS', 'OVERTIME_RATES', 'HOLIDAYS', 'CONTRACTOR_WITHHOLDING');

-- CreateEnum
CREATE TYPE "public"."CompanySize" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "public"."OrgUnitKind" AS ENUM ('DIRECTORATE', 'DEPARTMENT', 'SECTION');

-- CreateEnum
CREATE TYPE "public"."ScheduleType" AS ENUM ('FIXED', 'FLEXIBLE', 'SHIFT', 'ROTATION');

-- CreateEnum
CREATE TYPE "public"."ShiftKind" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'OFF');

-- CreateEnum
CREATE TYPE "public"."EmployeeStatus" AS ENUM ('ACTIVE', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "public"."IdDocumentType" AS ENUM ('BI', 'PASSPORT', 'RESIDENT_CARD');

-- CreateEnum
CREATE TYPE "public"."ContractType" AS ENUM ('INDEFINITE', 'FIXED_TERM', 'UNCERTAIN_TERM', 'PART_TIME', 'INTERNSHIP', 'TEMPORARY', 'NON_RESIDENT');

-- CreateEnum
CREATE TYPE "public"."ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'MOBILE_WALLET', 'CHEQUE');

-- CreateEnum
CREATE TYPE "public"."TerminationReason" AS ENUM ('CONTRACT_EXPIRY', 'EMPLOYEE_RESIGNATION', 'DISCIPLINARY_DISMISSAL', 'OBJECTIVE_DISMISSAL', 'MUTUAL_AGREEMENT', 'RETIREMENT', 'DEATH');

-- CreateEnum
CREATE TYPE "public"."TerminationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PunchType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "public"."PunchSource" AS ENUM ('WEB', 'KIOSK', 'BIOMETRIC', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "public"."RequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."LeaveType" AS ENUM ('VACATION', 'SICK', 'MARRIAGE', 'BEREAVEMENT', 'MATERNITY', 'PATERNITY', 'UNPAID', 'UNJUSTIFIED', 'OTHER_JUSTIFIED');

-- CreateEnum
CREATE TYPE "public"."OvertimeKind" AS ENUM ('WEEKDAY', 'REST_DAY', 'HOLIDAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "public"."ApprovalType" AS ENUM ('LEAVE', 'OVERTIME', 'ADVANCE', 'LOAN', 'EXPENSE', 'SALARY_CHANGE', 'PAYROLL_RUN', 'PAYMENT_BATCH', 'TERMINATION', 'ATTENDANCE_CORRECTION', 'TIMESHEET');

-- CreateEnum
CREATE TYPE "public"."PayItemKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CHARGE', 'INFORMATIVE');

-- CreateEnum
CREATE TYPE "public"."PayItemNature" AS ENUM ('FIXED', 'VARIABLE', 'CALCULATED');

-- CreateEnum
CREATE TYPE "public"."PayItemCategory" AS ENUM ('SALARY', 'ALLOWANCE', 'BENEFIT', 'INSURANCE', 'OVERTIME', 'BONUS', 'STATUTORY', 'ABSENCE', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PayrollPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."PayrollRunType" AS ENUM ('REGULAR', 'HOLIDAY_ALLOWANCE', 'CHRISTMAS_ALLOWANCE', 'BONUS', 'RETRO', 'SUPPLEMENTARY', 'FINAL_SETTLEMENT');

-- CreateEnum
CREATE TYPE "public"."PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."LoanType" AS ENUM ('ADVANCE', 'LOAN', 'GARNISHMENT');

-- CreateEnum
CREATE TYPE "public"."LoanStatus" AS ENUM ('PENDING', 'ACTIVE', 'SETTLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."ExpenseCategory" AS ENUM ('TRAVEL', 'PER_DIEM', 'FUEL', 'MATERIAL', 'REPRESENTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."BatchStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'RECONCILED', 'PARTIALLY_REJECTED');

-- CreateEnum
CREATE TYPE "public"."InstructionStatus" AS ENUM ('PENDING', 'SENT', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."Authority" AS ENUM ('AGT', 'INSS');

-- CreateEnum
CREATE TYPE "public"."FilingKind" AS ENUM ('IRT_WITHHOLDING', 'SS_REMUNERATION', 'CONTRACTOR_WITHHOLDING', 'ANNUAL_INCOME');

-- CreateEnum
CREATE TYPE "public"."FilingStatus" AS ENUM ('READY', 'SUBMITTED', 'PAID');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'TEST', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."CycleStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."AccidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "public"."NotificationKind" AS ENUM ('ALERT', 'DEADLINE', 'INFO', 'SUCCESS');

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'PROFESSIONAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "totp_secret" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "employee_id" UUID,
    "roles" "public"."Role"[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" UUID,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."one_time_codes" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "purpose" "public"."OtpPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roles" "public"."Role"[],
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."banks" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "swift" TEXT,
    "file_format" TEXT NOT NULL,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."provinces" (
    "name" TEXT NOT NULL,
    "municipalities" TEXT[],

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "public"."legal_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "kind" "public"."LegalTableKind" NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "legal_reference" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT NOT NULL,
    "nif" TEXT NOT NULL,
    "social_security_number" TEXT,
    "activity_code" TEXT,
    "size_class" "public"."CompanySize" NOT NULL DEFAULT 'SMALL',
    "province" TEXT,
    "address" TEXT,
    "careers_slug" TEXT,
    "default_currency" TEXT NOT NULL DEFAULT 'AOA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."establishments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geo_punch" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cost_centers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."org_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "public"."OrgUnitKind" NOT NULL DEFAULT 'DEPARTMENT',
    "name" TEXT NOT NULL,
    "head_employee_id" UUID,
    "cost_center_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_positions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "org_unit_id" UUID,
    "grade" TEXT,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."ScheduleType" NOT NULL DEFAULT 'FIXED',
    "weekly_hours" DECIMAL(5,2) NOT NULL DEFAULT 44,
    "start_time" TEXT,
    "end_time" TEXT,
    "days" TEXT[],
    "tolerance_minutes" INTEGER NOT NULL DEFAULT 10,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shift_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift" "public"."ShiftKind" NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" "public"."Gender",
    "birth_date" DATE,
    "marital_status" TEXT,
    "nationality" TEXT NOT NULL DEFAULT 'AO',
    "id_document_type" "public"."IdDocumentType" NOT NULL DEFAULT 'BI',
    "id_document_number" TEXT,
    "id_document_expiry" DATE,
    "nif" TEXT,
    "social_security_number" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "province" TEXT,
    "municipality" TEXT,
    "address" TEXT,
    "hire_date" DATE NOT NULL,
    "seniority_date" DATE,
    "status" "public"."EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "position_id" UUID,
    "org_unit_id" UUID,
    "establishment_id" UUID,
    "cost_center_id" UUID,
    "manager_id" UUID,
    "schedule_id" UUID,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employment_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "contract_type" "public"."ContractType" NOT NULL,
    "status" "public"."ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "probation_end_date" DATE,
    "renewals_count" INTEGER NOT NULL DEFAULT 0,
    "position_id" UUID,
    "base_salary" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "weekly_hours" DECIMAL(5,2) NOT NULL DEFAULT 44,
    "payment_method" "public"."PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "termination_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bank_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "split_percent" INTEGER NOT NULL DEFAULT 100,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "validated_at" TIMESTAMP(3),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employee_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "expires_at" DATE,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."terminations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason" "public"."TerminationReason" NOT NULL,
    "notice_date" DATE NOT NULL,
    "last_day" DATE NOT NULL,
    "settlement" JSONB,
    "settlement_total" DECIMAL(18,2),
    "status" "public"."TerminationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" "public"."PunchType" NOT NULL,
    "source" "public"."PunchSource" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "user_agent" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_corrections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "public"."PunchType" NOT NULL,
    "time" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "summary" JSONB,

    CONSTRAINT "attendance_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "public"."LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "justified" BOOLEAN NOT NULL DEFAULT true,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "document_id" UUID,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leave_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled_days" INTEGER NOT NULL DEFAULT 22,
    "carried_over" INTEGER NOT NULL DEFAULT 0,
    "taken" INTEGER NOT NULL DEFAULT 0,
    "scheduled" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."overtime_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" "public"."OvertimeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."timesheets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "project" TEXT NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "notes" TEXT,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_workflows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "public"."ApprovalType" NOT NULL,
    "steps" JSONB NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "public"."ApprovalType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "requester_user_id" UUID,
    "beneficiary_employee_id" UUID,
    "excluded_user_ids" TEXT[],
    "steps" JSONB NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approval_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pay_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."PayItemKind" NOT NULL,
    "nature" "public"."PayItemNature" NOT NULL,
    "category" "public"."PayItemCategory" NOT NULL DEFAULT 'OTHER',
    "formula" TEXT,
    "irt_subject" BOOLEAN NOT NULL DEFAULT true,
    "irt_exemption_limit" DECIMAL(18,2),
    "ss_subject" BOOLEAN NOT NULL DEFAULT true,
    "holiday_allowance_base" BOOLEAN NOT NULL DEFAULT false,
    "christmas_allowance_base" BOOLEAN NOT NULL DEFAULT false,
    "proportional" BOOLEAN NOT NULL DEFAULT false,
    "accounting_account" TEXT,
    "calculation_order" INTEGER NOT NULL DEFAULT 100,
    "visible_on_payslip" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" DATE,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "pay_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contract_pay_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "pay_item_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "contract_pay_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "payment_date" DATE NOT NULL,
    "status" "public"."PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "run_type" "public"."PayrollRunType" NOT NULL DEFAULT 'REGULAR',
    "status" "public"."PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totals" JSONB,
    "alerts" JSONB,
    "legal_tables_snapshot" JSONB,
    "calculated_at" TIMESTAMP(3),
    "calculated_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "paid_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_variables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "pay_item_id" UUID NOT NULL,
    "quantity" DECIMAL(10,2),
    "amount" DECIMAL(18,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payslips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "ss_base" DECIMAL(18,2) NOT NULL,
    "ss_employee" DECIMAL(18,2) NOT NULL,
    "ss_employer" DECIMAL(18,2) NOT NULL,
    "irt_taxable" DECIMAL(18,2) NOT NULL,
    "irt_base" DECIMAL(18,2) NOT NULL,
    "irt" DECIMAL(18,2) NOT NULL,
    "total_deductions" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "employer_cost" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "alerts" JSONB,
    "calculation_trace" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payslip_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "public"."PayItemKind" NOT NULL,
    "quantity" DECIMAL(10,2),
    "amount" DECIMAL(18,2) NOT NULL,
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "ss_amount" DECIMAL(18,2) NOT NULL,
    "source" TEXT NOT NULL,
    "trace" TEXT NOT NULL,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "public"."LoanType" NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "installments" INTEGER NOT NULL,
    "installment_value" DECIMAL(18,2) NOT NULL,
    "paid_installments" INTEGER NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL,
    "first_month" DATE NOT NULL,
    "status" "public"."LoanStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expense_claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" "public"."ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "receipt_key" TEXT,
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
    "paid_in_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "file_format" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "status" "public"."BatchStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "prepared_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_instructions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "employee_name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "public"."InstructionStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,

    CONSTRAINT "payment_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_filings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "authority" "public"."Authority" NOT NULL,
    "kind" "public"."FilingKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "status" "public"."FilingStatus" NOT NULL DEFAULT 'READY',
    "submitted_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contractor_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_nif" TEXT,
    "number" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "withholding" DECIMAL(18,2) NOT NULL,
    "file_key" TEXT,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_openings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "org_unit_id" UUID,
    "establishment_id" UUID,
    "location" TEXT NOT NULL,
    "work_regime" TEXT NOT NULL,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'OPEN',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."candidates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "cv_key" TEXT,
    "stage" "public"."CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "score" INTEGER,
    "notes" TEXT,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "interview_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_cycles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "self_assessment" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."CycleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."performance_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "performance" INTEGER,
    "potential" INTEGER,
    "comments" TEXT,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."goals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_employee_id" UUID,
    "from_user_id" UUID NOT NULL,
    "to_employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT,
    "message" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."trainings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."training_enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "training_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "certificate_expires_at" DATE,

    CONSTRAINT "training_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."disciplinary_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "employee_id" UUID NOT NULL,
    "instructor_id" UUID,
    "infraction" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "incident_date" DATE NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Nota de culpa',
    "deadline" DATE,
    "decision" TEXT,
    "status" "public"."CaseStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disciplinary_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."medical_exams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "done_at" DATE,
    "result" TEXT,

    CONSTRAINT "medical_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."accidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "severity" "public"."AccidentSeverity" NOT NULL,
    "days_lost" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "public"."NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."announcements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "group_by" TEXT,
    "schedule" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "public"."users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "public"."memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "public"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_codes_identifier_purpose_idx" ON "public"."one_time_codes"("identifier", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "public"."invitations"("token_hash");

-- CreateIndex
CREATE INDEX "legal_tables_kind_effective_from_idx" ON "public"."legal_tables"("kind", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "companies_careers_slug_key" ON "public"."companies"("careers_slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_nif_key" ON "public"."companies"("tenant_id", "nif");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_company_id_code_key" ON "public"."cost_centers"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_employee_id_date_key" ON "public"."shift_assignments"("employee_id", "date");

-- CreateIndex
CREATE INDEX "employees_tenant_id_status_idx" ON "public"."employees"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_number_key" ON "public"."employees"("company_id", "employee_number");

-- CreateIndex
CREATE INDEX "employment_contracts_tenant_id_end_date_idx" ON "public"."employment_contracts"("tenant_id", "end_date");

-- CreateIndex
CREATE INDEX "attendance_records_employee_id_timestamp_idx" ON "public"."attendance_records"("employee_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_idempotency_key_key" ON "public"."attendance_records"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_periods_company_id_year_month_key" ON "public"."attendance_periods"("company_id", "year", "month");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_status_idx" ON "public"."leave_requests"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employee_id_year_key" ON "public"."leave_balances"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflows_tenant_id_type_key" ON "public"."approval_workflows"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_idx" ON "public"."approval_requests"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pay_items_company_id_code_key" ON "public"."pay_items"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "contract_pay_items_contract_id_pay_item_id_key" ON "public"."contract_pay_items"("contract_id", "pay_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_company_id_year_month_key" ON "public"."payroll_periods"("company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "public"."payslips"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_batches_tenant_id_reference_key" ON "public"."payment_batches"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "tax_filings_company_id_kind_year_month_key" ON "public"."tax_filings"("company_id", "kind", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_cycle_id_employee_id_key" ON "public"."performance_reviews"("cycle_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_enrollments_training_id_employee_id_key" ON "public"."training_enrollments"("training_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "disciplinary_cases_tenant_id_reference_key" ON "public"."disciplinary_cases"("tenant_id", "reference");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "public"."notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversation_id_user_id_key" ON "public"."conversation_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_occurred_at_idx" ON "public"."audit_logs"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "public"."outbox_events"("published_at");

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employment_contracts" ADD CONSTRAINT "employment_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_accounts" ADD CONSTRAINT "bank_accounts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approval_actions" ADD CONSTRAINT "approval_actions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contract_pay_items" ADD CONSTRAINT "contract_pay_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."employment_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_instructions" ADD CONSTRAINT "payment_instructions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."training_enrollments" ADD CONSTRAINT "training_enrollments_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant isolation with Row-Level Security (docs/09, 9.6 rule 6).
-- The API runs tenant queries as role pagador_app inside a transaction that sets
-- app.tenant_id. Cross-tenant system work (login, public careers page, worker) must
-- set app.bypass_rls = 'on' explicitly.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pagador_app') THEN
    CREATE ROLE pagador_app NOLOGIN;
  END IF;
END $$;
GRANT pagador_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO pagador_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pagador_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pagador_app;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "companies" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "establishments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "establishments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "establishments" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_centers" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "org_units" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "job_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_positions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_positions" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "work_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_schedules" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_assignments" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employees" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "employment_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employment_contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employment_contracts" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_accounts" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_documents" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "terminations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "terminations" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_records" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_corrections" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "attendance_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_periods" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_requests" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "leave_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_balances" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "overtime_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overtime_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "overtime_requests" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "timesheets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timesheets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "timesheets" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "approval_workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_workflows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_workflows" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_requests" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "approval_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_actions" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "pay_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pay_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pay_items" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "contract_pay_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_pay_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_pay_items" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payroll_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_periods" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_runs" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payroll_variables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_variables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_variables" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payslips" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payslips" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payslip_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payslip_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payslip_lines" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loans" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "expense_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_claims" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payment_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_batches" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "payment_instructions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_instructions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_instructions" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "tax_filings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_filings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_filings" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "contractor_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractor_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contractor_invoices" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "job_openings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_openings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_openings" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "candidates" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "review_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_cycles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "review_cycles" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "performance_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "performance_reviews" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goals" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feedback" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "trainings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trainings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trainings" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "training_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "training_enrollments" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "disciplinary_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disciplinary_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "disciplinary_cases" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "medical_exams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_exams" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "medical_exams" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "accidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accidents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accidents" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "conversation_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_participants" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "announcements" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_reports" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs" USING (app_rls_bypass() OR tenant_id = app_tenant_id()) WITH CHECK (app_rls_bypass() OR tenant_id = app_tenant_id());

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
