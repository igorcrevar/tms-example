import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Role } from '../user/entities/role.entity';
import { User } from '../user/entities/user.entity';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { Driver } from './entities/driver.entity';
import { PinResetRequest } from './entities/pin-reset-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Driver, PinResetRequest, User, Role]), AuthModule],
  controllers: [DriverController],
  providers: [DriverService],
  exports: [TypeOrmModule, DriverService],
})
export class DriverModule {}
