import { Alert, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../api';

interface HealthResponse {
  status: 'ok' | 'error';
  details: { database: { status: 'up' | 'down' } };
}

export function DashboardPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async (): Promise<HealthResponse> => {
      // Health sits outside the staff namespace, so it needs its own base.
      const response = await adminApi.get<HealthResponse>('/health', { baseURL: '/api' });

      return response.data;
    },
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h2">
        Dashboard
      </Typography>

      {isPending && <CircularProgress size={24} aria-label="Loading API status" />}
      {isError && <Alert severity="error">The API is unreachable.</Alert>}
      {data && (
        <Chip
          color={data.status === 'ok' ? 'success' : 'error'}
          label={`API ${data.status} - database ${data.details.database.status}`}
        />
      )}
    </Stack>
  );
}
