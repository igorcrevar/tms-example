import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { DriverType } from '../entities/driver.entity';

export class CreateDriverDto {
  @ApiProperty({ example: 'DRV-0001' })
  @IsString()
  @Matches(/^[A-Z0-9-]{3,32}$/, {
    message: 'driverCode must be 3-32 upper-case letters, digits or hyphens',
  })
  driverCode!: string;

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

  @ApiProperty({ example: 'driver@tms.local' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ enum: DriverType })
  @IsEnum(DriverType)
  driverType!: DriverType;

  @ApiProperty({ example: '482913', description: 'Six digits; changeable later' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be six digits' })
  pin!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  @IsOptional()
  licenseNumber?: string;
}

export class SetDriverPinDto {
  @ApiProperty({ example: '918273' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be six digits' })
  pin!: string;
}

export class ForgotPinDto {
  @ApiProperty({ example: 'DRV-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  driverCode!: string;
}
