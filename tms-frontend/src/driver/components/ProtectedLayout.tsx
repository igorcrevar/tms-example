import { RequireSession } from '@/shared/components/RequireSession';
import { useSession } from '../api';
import { DriverLayout } from '../layouts/DriverLayout';

export function ProtectedLayout() {
  const session = useSession();

  return (
    <RequireSession session={session} loginPath="/driver/login">
      <DriverLayout />
    </RequireSession>
  );
}
