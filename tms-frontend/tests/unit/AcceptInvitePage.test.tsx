import { StrictMode, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptInvitePage } from '@/admin/pages/AcceptInvitePage';
import { adminApi } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const get = vi.mocked(adminApi.get);
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

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({
      data: { email: 'new@tms.local', firstName: 'New', expiresAt: '2026-12-01T00:00:00.000Z' },
    });
  });

  it('rejects a link with no token without calling the API', () => {
    renderPage(<AcceptInvitePage />, '/admin/accept-invite');

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid/i);
    expect(get).not.toHaveBeenCalled();
  });

  it('shows whose account is being activated', async () => {
    renderPage(<AcceptInvitePage />, '/admin/accept-invite?token=abc');

    expect(await screen.findByText('new@tms.local')).toBeInTheDocument();
  });

  it('drops the token from the address bar on mount', async () => {
    renderPage(<AcceptInvitePage />, '/admin/accept-invite?token=abc');

    // Nothing may hold a live invitation token: not history, not a referrer, not Sentry replay.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/accept-invite'),
    );
  });

  it('refuses to submit when the two passwords differ', async () => {
    const user = userEvent.setup();
    renderPage(<AcceptInvitePage />, '/admin/accept-invite?token=abc');

    await user.type(await screen.findByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), 'something else entirely');
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('activates the account and points the user at sign in', async () => {
    post.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<AcceptInvitePage />, '/admin/accept-invite?token=abc');

    await user.type(await screen.findByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    expect(post).toHaveBeenCalledWith('/invitations/accept', {
      token: 'abc',
      password: PASSWORD,
    });
    expect(await screen.findByRole('button', { name: /go to sign in/i })).toBeInTheDocument();
  });

  it('reports an invitation the server rejects', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 404, data: { message: 'This invitation is no longer valid' } },
      }),
    );
    const user = userEvent.setup();
    renderPage(<AcceptInvitePage />, '/admin/accept-invite?token=abc');

    await user.type(await screen.findByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
  });
});
