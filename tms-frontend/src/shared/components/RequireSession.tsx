import { Box, CircularProgress } from '@mui/material';
import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';

interface RequireSessionProps<TProfile> {
  session: UseQueryResult<TProfile | null>;
  loginPath: string;
  children: ReactElement;
}

export function RequireSession<TProfile>({
  session,
  loginPath,
  children,
}: RequireSessionProps<TProfile>) {
  const location = useLocation();

  if (session.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress aria-label="Checking session" />
      </Box>
    );
  }

  if (!session.data) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  return children;
}
