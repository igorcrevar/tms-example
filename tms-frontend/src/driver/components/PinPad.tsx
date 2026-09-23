import { Box, Button, Stack } from '@mui/material';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const PIN_LENGTH = 6;

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function PinPad({ value, onChange, disabled = false }: PinPadProps) {
  const press = (digit: string) => {
    if (value.length < PIN_LENGTH) {
      onChange(value + digit);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }} aria-hidden>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <Box
            key={index}
            sx={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: '2px solid',
              borderColor: 'primary.main',
              backgroundColor: index < value.length ? 'primary.main' : 'transparent',
            }}
          />
        ))}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {KEYS.map((digit) => (
          <Button
            key={digit}
            variant="outlined"
            onClick={() => press(digit)}
            disabled={disabled}
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          variant="text"
          onClick={() => onChange('')}
          disabled={disabled || value.length === 0}
        >
          Clear
        </Button>
        <Button variant="outlined" onClick={() => press('0')} disabled={disabled} aria-label="Digit 0">
          0
        </Button>
        <Button
          variant="text"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
        >
          ⌫
        </Button>
      </Box>
    </Stack>
  );
}
