import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from '@/admin/pages/LoginPage';
import { adminApi } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { post: vi.fn(), get: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const post = vi.mocked(adminApi.post);

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for the second factor instead of signing in on password alone', async () => {
    post.mockResolvedValueOnce({ data: { mfaRequired: true, enrolmentRequired: false } });
    const user = userEvent.setup();

    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@tms.local');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByLabelText(/authentication code/i)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@tms.local',
      password: 'correct horse battery staple',
    });
  });

  it('shows the enrolment QR when the account has no authenticator yet', async () => {
    post
      .mockResolvedValueOnce({ data: { mfaRequired: true, enrolmentRequired: true } })
      .mockResolvedValueOnce({
        data: { otpauthUri: 'otpauth://totp/x', qrDataUrl: 'data:image/png;base64,x', secret: 'S' },
      });
    const user = userEvent.setup();

    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@tms.local');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByAltText(/two-factor enrolment qr code/i)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/auth/2fa/enrol');
  });

  it('reports a rejected password without advancing', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Invalid credentials' } },
      }),
    );
    const user = userEvent.setup();

    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@tms.local');
    await user.type(screen.getByLabelText(/password/i), 'wrong password here');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.queryByLabelText(/authentication code/i)).not.toBeInTheDocument();
  });

  it('clears the code box when the second factor is rejected', async () => {
    post
      .mockResolvedValueOnce({ data: { mfaRequired: true, enrolmentRequired: false } })
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed'), {
          isAxiosError: true,
          response: { status: 401, data: { message: 'Invalid verification code' } },
        }),
      );
    const user = userEvent.setup();

    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@tms.local');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const codeField = await screen.findByLabelText(/authentication code/i);
    await user.type(codeField, '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid verification code');
    expect(codeField).toHaveValue('');
  });
});
