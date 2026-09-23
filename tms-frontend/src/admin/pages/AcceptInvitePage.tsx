import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { messageFor } from '../auth';
import { useAcceptInvitation, useInvitationPreview } from '../invitations';
import { MIN_PASSWORD_LENGTH } from '../../shared/auth/password';

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token') ?? '');

  // The token stays live while the user types, so it must not sit in the address bar,
  // the history entry or the referrer that long.
  useEffect(() => {
    if (location.search) {
      void navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError('The two passwords do not match');
      return;
    }

    try {
      await accept.mutateAsync({ token, password });
      setDone(true);
    } catch (cause) {
      setError(messageFor(cause, 'This invitation is no longer valid'));
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>
            Activate your account
          </Typography>

          {preview.isPending && token !== '' && <CircularProgress size={24} aria-label="Checking" />}

          {(token === '' || preview.isError) && (
            <Alert severity="error" role="alert">
              This invitation link is not valid. Ask an administrator to send a new one.
            </Alert>
          )}

          {done && (
            <Stack spacing={2}>
              <Alert severity="success">
                Your account is active. Sign in to set up two-factor authentication.
              </Alert>
              <Button variant="contained" onClick={() => void navigate('/admin/login')}>
                Go to sign in
              </Button>
            </Stack>
          )}

          {preview.data && !done && (
            <form onSubmit={submit} noValidate>
              <Stack spacing={2}>
                <Typography variant="body2">
                  Setting a password for <strong>{preview.data.email}</strong>.
                </Typography>

                {error && (
                  <Alert severity="error" role="alert">
                    {error}
                  </Alert>
                )}

                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                  required
                  fullWidth
                />
                <TextField
                  label="Confirm password"
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
                  disabled={accept.isPending || password.length < MIN_PASSWORD_LENGTH}
                  fullWidth
                >
                  Activate account
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
