-- AlterTable
ALTER TABLE "public"."approval_requests" ADD COLUMN     "beneficiary_manager_id" UUID,
ADD COLUMN     "beneficiary_name" TEXT;
