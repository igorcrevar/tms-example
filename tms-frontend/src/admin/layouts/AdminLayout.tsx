import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { Link, Outlet, useNavigate } from 'react-router-dom';

import { useLogout, useSession } from '../api';

export function AdminLayout() {
  const navigate = useNavigate();
  const session = useSession();
  const logout = useLogout();

  const signOut = async () => {
    await logout.mutateAsync();
    await navigate('/admin/login', { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component="h1">
            TMS Admin
          </Typography>
          <Button color="inherit" component={Link} to="/admin">
            Dashboard
          </Button>
          <Button color="inherit" component={Link} to="/admin/users" sx={{ flexGrow: 1, justifyContent: 'flex-start' }}>
            Users
          </Button>
          {session.data && (
            <Typography variant="body2">
              {session.data.email} ({session.data.role})
            </Typography>
          )}
          <Button color="inherit" onClick={() => void signOut()} disabled={logout.isPending}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ py: 4, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
