import { Box, CircularProgress } from '@mui/material';

export function Splash() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  );
}
