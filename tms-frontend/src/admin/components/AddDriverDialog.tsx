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
import { useCreateDriver } from '../users';

interface AddDriverDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddDriverDialog({ open, onClose }: AddDriverDialogProps) {
  const createDriver = useCreateDriver();
  const [form, setForm] = useState({
    driverCode: '',
    firstName: '',
    lastName: '',
    email: '',
    driverType: 'TRUCK' as 'TRUCK' | 'TRAIN',
    pin: '',
  });
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await createDriver.mutateAsync(form);
      // Clear before closing: the PIN must not survive in component state.
      setForm({
        driverCode: '',
        firstName: '',
        lastName: '',
        email: '',
        driverType: 'TRUCK',
        pin: '',
      });
      onClose();
    } catch (cause) {
      setError(messageFor(cause, 'Could not create the driver'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>Add a driver</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField
              label="Driver code"
              value={form.driverCode}
              onChange={(event) => update('driverCode')(event.target.value.toUpperCase())}
              required
              fullWidth
            />
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(event) => update('firstName')(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(event) => update('lastName')(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => update('email')(event.target.value)}
              required
              fullWidth
            />
            <TextField
              select
              label="Driver type"
              value={form.driverType}
              onChange={(event) => update('driverType')(event.target.value)}
              fullWidth
            >
              <MenuItem value="TRUCK">Truck</MenuItem>
              <MenuItem value="TRAIN">Train</MenuItem>
            </TextField>
            <TextField
              label="Initial PIN"
              type="password"
              value={form.pin}
              onChange={(event) => update('pin')(event.target.value.replace(/\D/g, ''))}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
              helperText="Six digits. The driver can be given a new one later."
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createDriver.isPending || form.pin.length !== 6}
          >
            Add driver
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
