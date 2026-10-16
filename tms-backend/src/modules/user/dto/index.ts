import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { RoleName } from '../entities/role.entity';
import { UserStatus } from '../entities/user.entity';
import { MIN_PASSWORD_LENGTH } from '../../auth/auth.constants';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: RoleName })
  @IsEnum(RoleName)
  @IsOptional()
  role?: RoleName;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class InviteUserDto {
  @ApiProperty({ example: 'admin@tms.local' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ enum: RoleName })
  @IsEnum(RoleName)
  role!: RoleName;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(256)
  password!: string;
}

export class InvitationTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;
}

export class MassEmailDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @ApiProperty({ example: 'Planned maintenance' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'subject must not be blank' })
  @Matches(/^[^\r\n]*$/, { message: 'subject must be a single line' })
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: 'body must not be blank' })
  body!: string;
}
