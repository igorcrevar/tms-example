import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class DriverJwtGuard extends AuthGuard('driver-jwt') {}
