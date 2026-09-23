import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';

import { useSession } from '../api';

export function TripsPage() {
  const session = useSession();

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h2">
        Today
      </Typography>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="body1">
              {session.data?.firstName} {session.data?.lastName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {session.data?.driverCode}
            </Typography>
            <Chip
              label={session.data?.driverType === 'TRAIN' ? 'Train driver' : 'Truck driver'}
              sx={{ alignSelf: 'flex-start' }}
            />
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary">
        No assigned shipments yet.
      </Typography>
    </Stack>
  );
}
