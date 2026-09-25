import { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { format } from 'date-fns';

import { SetPinDialog } from '../components/SetPinDialog';
import type { SetPinTarget } from '../components/SetPinDialog';
import { usePinResetRequests } from '../users';

export function PinResetRequestsPage() {
  const requests = usePinResetRequests();
  const [pinTarget, setPinTarget] = useState<SetPinTarget | null>(null);

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h2">
        PIN requests
      </Typography>

      {requests.isPending && <CircularProgress size={24} aria-label="Loading PIN requests" />}
      {requests.isError && <Alert severity="error">Could not load PIN requests.</Alert>}

      {requests.data && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Driver code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Requested at</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.data.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{request.driverCode}</TableCell>
                <TableCell>
                  {request.firstName} {request.lastName}
                </TableCell>
                <TableCell>{format(new Date(request.requestedAt), 'yyyy-MM-dd HH:mm')}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() =>
                      setPinTarget({ driverId: request.driverId, driverCode: request.driverCode })
                    }
                  >
                    Set PIN
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {requests.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>No open PIN requests.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <SetPinDialog driver={pinTarget} onClose={() => setPinTarget(null)} />
    </Stack>
  );
}
