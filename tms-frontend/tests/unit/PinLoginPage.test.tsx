import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PinLoginPage } from '@/driver/pages/PinLoginPage';
import { driverApi } from '@/driver/api';

vi.mock('@/driver/api', () => ({
  driverApi: { post: vi.fn(), get: vi.fn() },
  sessionKey: ['driver', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const post = vi.mocked(driverApi.post);

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function enterPin(user: ReturnType<typeof userEvent.setup>, pin: string) {
  for (const digit of pin) {
    await user.click(screen.getByRole('button', { name: `Digit ${digit}` }));
  }
}

describe('Driver PinLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps sign-in disabled until a full PIN and a driver code are entered', async () => {
    const user = userEvent.setup();

    renderPage(<PinLoginPage />);

    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/driver code/i), 'DRV-0001');
    await enterPin(user, '48291');
    expect(submit).toBeDisabled();

    await enterPin(user, '3');
    expect(submit).toBeEnabled();
  });

  it('posts the driver code and PIN', async () => {
    post.mockResolvedValueOnce({ data: { driver: { id: 'd1', driverCode: 'DRV-0001' } } });
    const user = userEvent.setup();

    renderPage(<PinLoginPage />);

    await user.type(screen.getByLabelText(/driver code/i), 'DRV-0001');
    await enterPin(user, '482913');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(post).toHaveBeenCalledWith('/auth/login', {
      driverCode: 'DRV-0001',
      pin: '482913',
    });
  });

  it('clears the PIN and warns after a rejected attempt', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Invalid credentials' } },
      }),
    );
    const user = userEvent.setup();

    renderPage(<PinLoginPage />);

    await user.type(screen.getByLabelText(/driver code/i), 'DRV-0001');
    await enterPin(user, '000000');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That driver code and PIN did not match',
    );
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('explains a rate-limited response differently from a wrong PIN', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 429, data: {} },
      }),
    );
    const user = userEvent.setup();

    renderPage(<PinLoginPage />);

    await user.type(screen.getByLabelText(/driver code/i), 'DRV-0001');
    await enterPin(user, '482913');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });
});
