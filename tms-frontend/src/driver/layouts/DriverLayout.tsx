import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { Outlet, useNavigate } from 'react-router-dom';

import { useLogout } from '../api';

export function DriverLayout() {
  const navigate = useNavigate();
  const logout = useLogout();

  const signOut = async () => {
    await logout.mutateAsync();
    await navigate('/driver/login', { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
            TMS Driver
          </Typography>
          <Button color="inherit" onClick={() => void signOut()} disabled={logout.isPending}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="sm" sx={{ py: 3, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
