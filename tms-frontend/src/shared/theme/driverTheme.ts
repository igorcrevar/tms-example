import { createTheme } from '@mui/material/styles';

/** Larger type and hit targets: drivers use this on a phone, often gloved. */
export const driverTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#38bdf8' },
    background: { default: '#0f172a', paper: '#1e293b' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'].join(','),
    button: { fontSize: '1.125rem', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: { root: { minHeight: 56 } },
    },
  },
});
