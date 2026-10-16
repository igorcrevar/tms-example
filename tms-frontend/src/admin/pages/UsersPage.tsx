import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import { messageFor } from '../auth';
import { AddDriverDialog } from '../components/AddDriverDialog';
import { InviteUserDialog } from '../components/InviteUserDialog';
import { MassEmailDialog } from '../components/MassEmailDialog';
import { SetPinDialog } from '../components/SetPinDialog';
import type { SetPinTarget } from '../components/SetPinDialog';
import {
  ROLE_NAMES,
  useDeleteUser,
  useResendInvitation,
  useResetTwoFactor,
  useUsers,
} from '../users';
import type { MassEmailResult, UserSummary } from '../users';

const STATUS_COLOUR = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'default',
} as const;

const MAX_RECIPIENTS = 100;

export function UsersPage() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<SetPinTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [twoFactorTarget, setTwoFactorTarget] = useState<UserSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [massEmailOpen, setMassEmailOpen] = useState(false);

  const users = useUsers({ ...(filter === 'all' ? {} : { role: filter }), page, limit });
  const removeUser = useDeleteUser();
  const resetTwoFactor = useResetTwoFactor();
  const resendInvitation = useResendInvitation();

  const pageIds = users.data?.items.map((user) => user.id) ?? [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const toggleOne = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );

  const togglePage = () =>
    setSelected((current) =>
      allOnPageSelected
        ? current.filter((id) => !pageIds.includes(id))
        : [...new Set([...current, ...pageIds])],
    );

  const onMassEmailSent = (result: MassEmailResult) => {
    setMassEmailOpen(false);
    setError(null);
    setNotice(null);

    const total = result.sent + result.failed.length;

    if (result.failed.length > 0) {
      // Keep the misses selected so the admin can see and retry exactly them.
      setSelected(result.failed.map((failure) => failure.userId));
      setError(
        `The email reached ${result.sent} of ${total} ${total === 1 ? 'user' : 'users'}; ` +
          `${result.failed.length} failed. Those users are still selected.`,
      );
    } else {
      setSelected([]);
      setNotice(`Email sent to ${result.sent} ${result.sent === 1 ? 'user' : 'users'}`);
    }
  };

  // A refused delete (403, or 400 for your own account) must say so rather than
  // leaving a dead button and an unhandled rejection.
  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    setError(null);

    try {
      await removeUser.mutateAsync(deleteTarget.id);
      setSelected((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteTarget(null);
      setError(messageFor(cause, 'Could not delete that user'));
    }
  };

  const confirmTwoFactorReset = async () => {
    if (!twoFactorTarget) {
      return;
    }

    setError(null);

    try {
      await resetTwoFactor.mutateAsync(twoFactorTarget.id);
      setTwoFactorTarget(null);
    } catch (cause) {
      setTwoFactorTarget(null);
      setError(messageFor(cause, 'Could not reset two-factor for that user'));
    }
  };

  // The row does not change on success, so say that the mail went out.
  const resend = async (user: UserSummary) => {
    setError(null);
    setNotice(null);

    try {
      await resendInvitation.mutateAsync(user.id);
      setNotice(`Invitation resent to ${user.email}`);
    } catch (cause) {
      setError(messageFor(cause, 'Could not resend that invitation'));
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h4" component="h2" sx={{ flexGrow: 1 }}>
          Users
        </Typography>
        <Button
          variant="outlined"
          disabled={selected.length === 0 || selected.length > MAX_RECIPIENTS}
          onClick={() => setMassEmailOpen(true)}
        >
          Email selected ({selected.length}
          {selected.length > MAX_RECIPIENTS ? `, max ${MAX_RECIPIENTS}` : ''})
        </Button>
        <Button variant="outlined" onClick={() => setDriverOpen(true)}>
          Add driver
        </Button>
        <Button variant="contained" onClick={() => setInviteOpen(true)}>
          Invite user
        </Button>
      </Stack>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_event, next: string | null) => {
          if (next) {
            setFilter(next);
            setPage(1);
          }
        }}
        aria-label="Filter by role"
      >
        <ToggleButton value="all">All</ToggleButton>
        {ROLE_NAMES.map((role) => (
          <ToggleButton key={role} value={role}>
            {role}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {error && (
        <Alert severity="error" role="alert" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {users.isPending && <CircularProgress size={24} aria-label="Loading users" />}
      {users.isError && <Alert severity="error">Could not load users.</Alert>}

      {users.data && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && pageIds.some((id) => selected.includes(id))}
                  onChange={togglePage}
                  slotProps={{ input: { 'aria-label': 'Select all on this page' } }}
                />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.data.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.includes(user.id)}
                    onChange={() => toggleOne(user.id)}
                    slotProps={{ input: { 'aria-label': `Select ${user.email}` } }}
                  />
                </TableCell>
                <TableCell>
                  {user.firstName} {user.lastName}
                  {user.driver && ` (${user.driver.driverCode})`}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role}</TableCell>
                <TableCell>
                  <Chip size="small" color={STATUS_COLOUR[user.status]} label={user.status} />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    {user.driver && (
                      <Button
                        size="small"
                        onClick={() =>
                          setPinTarget({
                            driverId: user.driver!.id,
                            driverCode: user.driver!.driverCode,
                          })
                        }
                      >
                        Change PIN
                      </Button>
                    )}
                    {!user.driver && user.status === 'INVITED' && (
                      <Button
                        size="small"
                        disabled={resendInvitation.isPending}
                        onClick={() => void resend(user)}
                      >
                        Resend invitation
                      </Button>
                    )}
                    {!user.driver && user.status === 'ACTIVE' && (
                      <Button size="small" onClick={() => setTwoFactorTarget(user)}>
                        Reset 2FA
                      </Button>
                    )}
                    {!user.isSuperAdmin && (
                      <Button
                        size="small"
                        color="error"
                        disabled={removeUser.isPending && deleteTarget?.id === user.id}
                        onClick={() => setDeleteTarget(user)}
                      >
                        Delete
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {users.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>No users match this filter.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {users.data && (
        <TablePagination
          component="div"
          count={users.data.total}
          page={page - 1}
          rowsPerPage={limit}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_event, next) => setPage(next + 1)}
          onRowsPerPageChange={(event) => {
            setLimit(Number(event.target.value));
            setPage(1);
          }}
        />
      )}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <AddDriverDialog open={driverOpen} onClose={() => setDriverOpen(false)} />
      <SetPinDialog driver={pinTarget} onClose={() => setPinTarget(null)} />
      <MassEmailDialog
        userIds={selected}
        open={massEmailOpen}
        onClose={() => setMassEmailOpen(false)}
        onSent={onMassEmailSent}
      />

      <Dialog open={twoFactorTarget !== null} onClose={() => setTwoFactorTarget(null)}>
        <DialogTitle>Reset two-factor for {twoFactorTarget?.email}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Their authenticator stops working and they enrol a new one at their next sign-in. Their
            password is unchanged, and any session they have open is ended.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTwoFactorTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void confirmTwoFactorReset()}>
            Reset 2FA
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete {deleteTarget?.email}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The account is deactivated and can no longer sign in. The record is kept, and the email
            address becomes available again.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
