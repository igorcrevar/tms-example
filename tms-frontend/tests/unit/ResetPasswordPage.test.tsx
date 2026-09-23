import { StrictMode, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordPage } from '@/admin/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/admin/pages/ResetPasswordPage';
import { adminApi } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const post = vi.mocked(adminApi.post);

const PASSWORD = 'a long enough password';

/** Exposes the address bar, so a test can assert the live token no longer sits in it. */
function LocationProbe() {
  const location = useLocation();

  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderPage(ui: ReactElement, url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // StrictMode as main.tsx mounts it: the token is captured once and must survive
  // the remount React simulates there.
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks the API for a reset link', async () => {
    post.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<ForgotPasswordPage />, '/admin/forgot-password');

    await user.type(screen.getByLabelText(/email/i), 'staff@tms.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'staff@tms.local' });
    expect(await screen.findByText(/if that address has an account/i)).toBeInTheDocument();
  });

  it('says the same thing when the server rejects the address', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 429, data: { message: 'Too many requests' } },
      }),
    );
    const user = userEvent.setup();
    renderPage(<ForgotPasswordPage />, '/admin/forgot-password');

    await user.type(screen.getByLabelText(/email/i), 'nobody@tms.local');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    // The page must never let the visitor tell a real address from an unknown one.
    expect(await screen.findByText(/if that address has an account/i)).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a link with no token without calling the API', () => {
    renderPage(<ResetPasswordPage />, '/admin/reset-password');

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('drops the token from the address bar on mount', async () => {
    renderPage(<ResetPasswordPage />, '/admin/reset-password?token=abc');

    // Nothing may hold a live reset token: not history, not a referrer, not Sentry replay.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/reset-password'),
    );
  });

  it('refuses to submit when the two passwords differ', async () => {
    const user = userEvent.setup();
    renderPage(<ResetPasswordPage />, '/admin/reset-password?token=abc');

    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), 'something else entirely');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('sets the password and points the user at sign in', async () => {
    post.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<ResetPasswordPage />, '/admin/reset-password?token=abc');

    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'abc',
      password: PASSWORD,
    });
    expect(await screen.findByRole('button', { name: /go to sign in/i })).toBeInTheDocument();
  });

  it('reports a token the server rejects', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 404, data: { message: 'This password reset link is no longer valid' } },
      }),
    );
    const user = userEvent.setup();
    renderPage(<ResetPasswordPage />, '/admin/reset-password?token=abc');

    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
  });
});
