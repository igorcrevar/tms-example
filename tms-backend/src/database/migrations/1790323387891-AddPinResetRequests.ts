import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPinResetRequests1790323387891 implements MigrationInterface {
  name = 'AddPinResetRequests1790323387891';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "pin_reset_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driverId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, "resolvedById" uuid, CONSTRAINT "PK_c9a93ebfca9e9c34d080ebfc36a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pin_reset_requests_open_driver" ON "pin_reset_requests"  ("driverId") WHERE "resolvedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pin_reset_requests" ADD CONSTRAINT "FK_8c570d4eb39aabc369f0630b844" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pin_reset_requests" ADD CONSTRAINT "FK_a56fa2b21123bf5fb76739d9ccc" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pin_reset_requests" DROP CONSTRAINT "FK_a56fa2b21123bf5fb76739d9ccc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pin_reset_requests" DROP CONSTRAINT "FK_8c570d4eb39aabc369f0630b844"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_pin_reset_requests_open_driver"`);
    await queryRunner.query(`DROP TABLE "pin_reset_requests"`);
  }
}
