import { Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h4" component="h2">
        Page not found
      </Typography>
      <Button component={Link} to="/admin" variant="contained">
        Back to dashboard
      </Button>
    </Stack>
  );
}
