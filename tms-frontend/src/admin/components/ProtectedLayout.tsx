import { RequireSession } from '@/shared/components/RequireSession';
import { useSession } from '../api';
import { AdminLayout } from '../layouts/AdminLayout';

export function ProtectedLayout() {
  const session = useSession();

  return (
    <RequireSession session={session} loginPath="/admin/login">
      <AdminLayout />
    </RequireSession>
  );
}
