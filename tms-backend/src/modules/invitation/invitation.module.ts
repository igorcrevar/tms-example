import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { Role } from '../user/entities/role.entity';
import { User } from '../user/entities/user.entity';
import { Invitation } from './entities/invitation.entity';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invitation, User, Role]), AuthModule, MailModule],
  controllers: [InvitationController],
  providers: [InvitationService],
})
export class InvitationModule {}
