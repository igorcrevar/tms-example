import { Driver } from '../driver/entities/driver.entity';
import { User } from './entities/user.entity';
import { RoleName } from './entities/role.entity';

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName | null;
  isSuperAdmin: boolean;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  driver: { id: string; driverCode: string; driverType: string } | null;
}

/** The only shape user data leaves the API in; secret columns never appear. */
export function toUserSummary(user: User, driver?: Driver | null): UserSummary {
  const roleName = user.role?.name ?? null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: roleName,
    isSuperAdmin: user.role?.isSuperAdmin ?? false,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    driver: driver
      ? { id: driver.id, driverCode: driver.driverCode, driverType: driver.driverType }
      : null,
  };
}
