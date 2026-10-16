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
import { useSendMassEmail } from '../users';
import type { MassEmailResult } from '../users';

interface MassEmailDialogProps {
  userIds: string[];
  open: boolean;
  onClose: () => void;
  onSent: (result: MassEmailResult) => void;
}

export function MassEmailDialog({ userIds, open, onClose, onSent }: MassEmailDialogProps) {
  const sendMassEmail = useSendMassEmail();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const result = await sendMassEmail.mutateAsync({ userIds, subject, body });
      setSubject('');
      setBody('');
      onSent(result);
    } catch (cause) {
      setError(messageFor(cause, 'Could not send the email'));
    }
  };

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={sendMassEmail.isPending ? undefined : close}
      fullWidth
      maxWidth="sm"
    >
      <form onSubmit={submit} noValidate>
        <DialogTitle>
          Email {userIds.length} selected {userIds.length === 1 ? 'user' : 'users'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField
              label="Subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
              fullWidth
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              label="Message"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
              fullWidth
              multiline
              minRows={6}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
              helperText="Plain text; formatting is not preserved."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={sendMassEmail.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={sendMassEmail.isPending || !subject.trim() || !body.trim()}
          >
            Send email
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
