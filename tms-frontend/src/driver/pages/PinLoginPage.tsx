import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import { PinPad } from '../components/PinPad';
import { useDriverLogin, useForgotPin } from '../auth';

const PIN_LENGTH = 6;

export function PinLoginPage() {
  const navigate = useNavigate();
  const login = useDriverLogin();
  const forgotPin = useForgotPin();
  const [driverCode, setDriverCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);

    try {
      await login.mutateAsync({ driverCode, pin });
      await navigate('/driver', { replace: true });
    } catch (cause) {
      setPin('');
      setError(
        axios.isAxiosError(cause) && cause.response?.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'That driver code and PIN did not match.',
      );
    }
  };

  const requestReset = async () => {
    setError(null);
    setNotice(null);

    try {
      await forgotPin.mutateAsync(driverCode);
      setNotice('Your dispatcher has been notified and will give you a new PIN.');
    } catch (cause) {
      setError(
        axios.isAxiosError(cause) && cause.response?.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Could not send the request. Try again.',
      );
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
      <Card sx={{ width: '100%', maxWidth: 360 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>
            Driver sign in
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {error}
            </Alert>
          )}
          {notice && (
            <Alert severity="success" sx={{ mb: 2 }} role="status">
              {notice}
            </Alert>
          )}

          <Stack spacing={3}>
            <TextField
              label="Driver code"
              value={driverCode}
              onChange={(event) => setDriverCode(event.target.value.toUpperCase())}
              autoComplete="username"
              fullWidth
            />

            <PinPad value={pin} onChange={setPin} disabled={login.isPending} />

            <Button
              variant="contained"
              size="large"
              onClick={() => void submit()}
              disabled={login.isPending || pin.length !== PIN_LENGTH || driverCode.length === 0}
              fullWidth
            >
              Sign in
            </Button>

            <Button
              variant="text"
              onClick={() => void requestReset()}
              disabled={forgotPin.isPending || driverCode.length === 0}
              fullWidth
            >
              Forgotten your PIN?
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
