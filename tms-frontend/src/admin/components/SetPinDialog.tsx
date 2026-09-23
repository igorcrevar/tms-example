import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';

import { messageFor } from '../auth';
import { useSetDriverPin } from '../users';
import type { UserSummary } from '../users';

interface SetPinDialogProps {
  user: UserSummary | null;
  onClose: () => void;
}

export function SetPinDialog({ user, onClose }: SetPinDialogProps) {
  const setPin = useSetDriverPin();
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!user?.driver) {
      return;
    }

    try {
      await setPin.mutateAsync({ driverId: user.driver.id, pin });
      setPinValue('');
      onClose();
    } catch (cause) {
      setError(messageFor(cause, 'Could not change the PIN'));
    }
  };

  return (
    <Dialog open={user !== null} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit} noValidate>
        <DialogTitle>New PIN for {user?.driver?.driverCode}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField
              label="New PIN"
              type="password"
              value={pin}
              onChange={(event) => setPinValue(event.target.value.replace(/\D/g, ''))}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
              helperText="Signs the driver out of any existing session."
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={setPin.isPending || pin.length !== 6}>
            Change PIN
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
