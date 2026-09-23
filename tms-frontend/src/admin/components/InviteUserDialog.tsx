import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';

import { messageFor } from '../auth';
import { ROLE_NAMES, useInviteUser } from '../users';

// Drivers are created with a PIN, not invited; the backend refuses them anyway.
const INVITABLE_ROLES = ROLE_NAMES.filter((role) => role !== 'DRIVER');

interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InviteUserDialog({ open, onClose }: InviteUserDialogProps) {
  const invite = useInviteUser();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await invite.mutateAsync({ email, firstName, lastName, role });
      setEmail('');
      setFirstName('');
      setLastName('');
      onClose();
    } catch (cause) {
      setError(messageFor(cause, 'Could not send the invitation'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="First name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Last name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              fullWidth
            />
            <TextField
              select
              label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              helperText="Drivers are added directly, not invited."
              fullWidth
            >
              {INVITABLE_ROLES.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={invite.isPending}>
            Send invitation
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
