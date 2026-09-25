import { useState } from 'react';
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { messageFor, useChangePassword } from '../auth';
import { MIN_PASSWORD_LENGTH } from '../../shared/auth/password';

export const PASSWORD_CHANGED_MESSAGE =
  'Your password is changed and every session has been signed out. Sign in again with the new one.';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const change = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmation) {
      setError('The two new passwords do not match');
      return;
    }

    try {
      await change.mutateAsync({ currentPassword, newPassword });
      await navigate('/admin/login', {
        replace: true,
        state: { message: PASSWORD_CHANGED_MESSAGE },
      });
    } catch (cause) {
      setError(messageFor(cause, 'The current password is not correct'));
    }
  };

  return (
    <Card sx={{ maxWidth: 440 }}>
      <CardContent>
        <Typography variant="h5" component="h1" gutterBottom>
          Change password
        </Typography>

        <form onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}

            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              fullWidth
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              required
              fullWidth
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
              fullWidth
            />
            <Button
              type="submit"
              variant="contained"
              disabled={
                change.isPending ||
                currentPassword === '' ||
                newPassword.length < MIN_PASSWORD_LENGTH
              }
              fullWidth
            >
              Change password
            </Button>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}
