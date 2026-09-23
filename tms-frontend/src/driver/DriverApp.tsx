import { CssBaseline, ThemeProvider } from '@mui/material';
import { Route, Routes } from 'react-router-dom';

import { driverTheme } from '@/shared/theme';
import { ProtectedLayout } from './components/ProtectedLayout';
import { PinLoginPage } from './pages/PinLoginPage';
import { TripsPage } from './pages/TripsPage';

/** Lazily loaded by the root router, so this tree is its own bundle chunk. */
export default function DriverApp() {
  return (
    <ThemeProvider theme={driverTheme}>
      <CssBaseline />
      <Routes>
        <Route path="login" element={<PinLoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<TripsPage />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
