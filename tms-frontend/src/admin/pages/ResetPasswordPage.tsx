import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { messageFor, useResetPassword } from '../auth';
import { MIN_PASSWORD_LENGTH } from '../../shared/auth/password';

export function ResetPasswordPage() {
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

  const reset = useResetPassword();

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
      await reset.mutateAsync({ token, password });
      setDone(true);
    } catch (cause) {
      setError(messageFor(cause, 'This password reset link is no longer valid'));
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
            Choose a new password
          </Typography>

          {token === '' && (
            <Alert severity="error" role="alert">
              This reset link is not valid. Ask for a new one from the sign-in page.
            </Alert>
          )}

          {done && (
            <Stack spacing={2}>
              <Alert severity="success">
                Your password is set, and every other session has been revoked — any still open
                stops working within a few minutes. Sign in with your authenticator code as usual.
              </Alert>
              <Button variant="contained" onClick={() => void navigate('/admin/login')}>
                Go to sign in
              </Button>
            </Stack>
          )}

          {token !== '' && !done && (
            <form onSubmit={submit} noValidate>
              <Stack spacing={2}>
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
                  disabled={reset.isPending || password.length < MIN_PASSWORD_LENGTH}
                  fullWidth
                >
                  Set new password
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
