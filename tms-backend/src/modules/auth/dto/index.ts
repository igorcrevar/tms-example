import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../auth.constants';

export class StaffLoginDto {
  @ApiProperty({ example: 'admin@tms.local' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(256)
  password!: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;
}

export class DriverLoginDto {
  @ApiProperty({ example: 'DRV-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  driverCode!: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be six digits' })
  pin!: string;
}

export class ChangePinDto {
  @ApiProperty({ example: '482913' })
  @IsString()
  @Length(6, 6)
  currentPin!: string;

  @ApiProperty({ example: '918273' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'newPin must be six digits' })
  newPin!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@tms.local' })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
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
