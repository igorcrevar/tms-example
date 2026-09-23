import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790176001146 implements MigrationInterface {
  name = 'InitialSchema1790176001146';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."permissions_action_enum" AS ENUM('manage', 'create', 'read', 'update', 'delete')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."permissions_subject_enum" AS ENUM('all', 'User', 'Role', 'Driver', 'Shipment', 'Vehicle')`,
    );
    await queryRunner.query(
      `CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" "public"."permissions_action_enum" NOT NULL, "subject" "public"."permissions_subject_enum" NOT NULL, "description" character varying(255), CONSTRAINT "uq_permissions_action_subject" UNIQUE ("action", "subject"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."roles_name_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'DRIVER')`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" "public"."roles_name_enum" NOT NULL, "description" character varying(255), "pinLogin" boolean NOT NULL DEFAULT false, "isSuperAdmin" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_roles_name" ON "roles"  ("name") `);
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "firstName" character varying(100) NOT NULL, "lastName" character varying(100) NOT NULL, "passwordHash" character varying(255), "status" "public"."users_status_enum" NOT NULL DEFAULT 'INVITED', "totpSecret" character varying(255), "totpEnabledAt" TIMESTAMP WITH TIME ZONE, "failedLoginAttempts" integer NOT NULL DEFAULT '0', "lockedUntil" TIMESTAMP WITH TIME ZONE, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "roleId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users"  ("email") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."auth_tokens_purpose_enum" AS ENUM('PASSWORD_RESET')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenHash" character(64) NOT NULL, "purpose" "public"."auth_tokens_purpose_enum" NOT NULL, "userId" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_41e9ddfbb32da18c4e85e45c2fd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_auth_tokens_token_hash" ON "auth_tokens"  ("tokenHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_auth_tokens_user_purpose" ON "auth_tokens"  ("userId", "purpose") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."refresh_tokens_audience_enum" AS ENUM('staff', 'driver')`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "familyId" uuid NOT NULL, "userId" uuid NOT NULL, "audience" "public"."refresh_tokens_audience_enum" NOT NULL, "tokenHash" character(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "replacedByTokenId" uuid, "userAgent" character varying(255), "ipAddress" character varying(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens"  ("familyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_tokens_token_hash" ON "refresh_tokens"  ("tokenHash") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."drivers_drivertype_enum" AS ENUM('TRUCK', 'TRAIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "drivers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driverCode" character varying(32) NOT NULL, "userId" uuid NOT NULL, "driverType" "public"."drivers_drivertype_enum" NOT NULL, "pinHash" character varying(255) NOT NULL, "pinUpdatedAt" TIMESTAMP WITH TIME ZONE, "licenseNumber" character varying(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "REL_57d866371f392f459cd9ee46f6" UNIQUE ("userId"), CONSTRAINT "PK_92ab3fb69e566d3eb0cae896047" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_drivers_driver_code" ON "drivers"  ("driverCode") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_drivers_user_id" ON "drivers"  ("userId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenHash" character(64) NOT NULL, "userId" uuid NOT NULL, "roleId" uuid NOT NULL, "invitedById" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "acceptedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invitations_token_hash" ON "invitations"  ("tokenHash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions" ("roleId" uuid NOT NULL, "permissionId" uuid NOT NULL, CONSTRAINT "PK_d430a02aad006d8a70f3acd7d03" PRIMARY KEY ("roleId", "permissionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4599f8b8f548d35850afa2d12" ON "role_permissions"  ("roleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_06792d0c62ce6b0203c03643cd" ON "role_permissions"  ("permissionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_368e146b785b574f42ae9e53d5e" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_c25fb956ebada4b256501585cca" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_57d866371f392f459cd9ee46f6a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_c16fdad3aea7ec7b047aedb9afe" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_7f2c37e6463b81cf0f2c72d2819" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_b4599f8b8f548d35850afa2d12c" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_06792d0c62ce6b0203c03643cdd" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_06792d0c62ce6b0203c03643cdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_b4599f8b8f548d35850afa2d12c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_7f2c37e6463b81cf0f2c72d2819"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_c16fdad3aea7ec7b047aedb9afe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_57d866371f392f459cd9ee46f6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_c25fb956ebada4b256501585cca"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_368e146b785b574f42ae9e53d5e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_06792d0c62ce6b0203c03643cd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b4599f8b8f548d35850afa2d12"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP INDEX "public"."uq_invitations_token_hash"`);
    await queryRunner.query(`DROP TABLE "invitations"`);
    await queryRunner.query(`DROP INDEX "public"."uq_drivers_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_drivers_driver_code"`);
    await queryRunner.query(`DROP TABLE "drivers"`);
    await queryRunner.query(`DROP TYPE "public"."drivers_drivertype_enum"`);
    await queryRunner.query(`DROP INDEX "public"."uq_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."idx_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_refresh_tokens_family_id"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."refresh_tokens_audience_enum"`);
    await queryRunner.query(`DROP INDEX "public"."ix_auth_tokens_user_purpose"`);
    await queryRunner.query(`DROP INDEX "public"."uq_auth_tokens_token_hash"`);
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."auth_tokens_purpose_enum"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."uq_roles_name"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TYPE "public"."roles_name_enum"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TYPE "public"."permissions_subject_enum"`);
    await queryRunner.query(`DROP TYPE "public"."permissions_action_enum"`);
  }
}
