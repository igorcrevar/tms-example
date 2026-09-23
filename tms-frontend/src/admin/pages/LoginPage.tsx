import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

import type { TotpEnrolment } from '@/shared/auth/types';
import { messageFor, useStaffLogin, useTotpEnrolment, useTotpVerify } from '../auth';

type Step = 'credentials' | 'code';

export function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = useStaffLogin();
  const enrol = useTotpEnrolment();
  const verify = useTotpVerify();

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const challenge = await login.mutateAsync({ email, password });

      if (challenge.enrolmentRequired) {
        setEnrolment(await enrol.mutateAsync());
      }

      setPassword('');
      setStep('code');
    } catch (cause) {
      setError(messageFor(cause, 'Invalid credentials'));
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await verify.mutateAsync(code);
      await navigate('/admin', { replace: true });
    } catch (cause) {
      setCode('');
      setError(messageFor(cause, 'Invalid verification code'));
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" component="h1" gutterBottom>
            TMS Admin
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {error}
            </Alert>
          )}

          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} noValidate>
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={login.isPending} fullWidth>
                  Continue
                </Button>
                <Link component={RouterLink} to="/admin/forgot-password" variant="body2">
                  Forgot password?
                </Link>
              </Stack>
            </form>
          ) : (
            <form onSubmit={submitCode} noValidate>
              <Stack spacing={2}>
                {enrolment && (
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      Scan this with your authenticator app, then enter the code it shows.
                    </Typography>
                    <Box
                      component="img"
                      src={enrolment.qrDataUrl}
                      alt="Two-factor enrolment QR code"
                      sx={{ alignSelf: 'center', width: 180, height: 180 }}
                    />
                  </Stack>
                )}
                <TextField
                  label="Authentication code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
                  autoComplete="one-time-code"
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={verify.isPending} fullWidth>
                  Verify
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
