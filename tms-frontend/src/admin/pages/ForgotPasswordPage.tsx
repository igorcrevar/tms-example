import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { useRequestPasswordReset } from '../auth';

export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // The same confirmation whatever the server did: the page must not say who has an account.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    await requestReset.mutateAsync(email).catch(() => undefined);
    setSent(true);
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
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>
            Reset your password
          </Typography>

          {sent ? (
            <Stack spacing={2}>
              <Alert severity="success">
                If that address has an account, a reset link is on its way. It expires in an hour.
              </Alert>
              <Button component={RouterLink} to="/admin/login" variant="contained">
                Back to sign in
              </Button>
            </Stack>
          ) : (
            <form onSubmit={submit} noValidate>
              <Stack spacing={2}>
                <Typography variant="body2">
                  Enter your email address and we will send you a link to choose a new password.
                  Your authenticator app is unaffected.
                </Typography>
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={requestReset.isPending || email.length === 0}
                  fullWidth
                >
                  Send reset link
                </Button>
                <Button component={RouterLink} to="/admin/login" size="small">
                  Back to sign in
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
