import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1d4ed8' },
    secondary: { main: '#0f766e' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'].join(','),
  },
});
