import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangePasswordPage, PASSWORD_CHANGED_MESSAGE } from '@/admin/pages/ChangePasswordPage';
import { adminApi, sessionKey } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const post = vi.mocked(adminApi.post);

const CURRENT = 'correct horse battery staple';
const NEW = 'staple battery horse correct';

/** Exposes where the page sent the user, and the notice it handed the sign-in page. */
function LocationProbe() {
  const location = useLocation();
  const message = (location.state as { message?: string } | null)?.message ?? '';

  return <span data-testid="location">{location.pathname + '|' + message}</span>;
}

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionKey, { id: 'u1', email: 'admin@tms.local', role: 'ADMIN' });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/change-password']}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return queryClient;
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, confirmation: string) {
  await user.type(screen.getByLabelText(/current password/i), CURRENT);
  await user.type(screen.getByLabelText(/^new password/i), NEW);
  await user.type(screen.getByLabelText(/confirm new password/i), confirmation);
  await user.click(screen.getByRole('button', { name: /change password/i }));
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to submit when the two new passwords differ', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />);

    await fillIn(user, 'something else entirely');

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('changes the password, drops the session and sends the user to sign in', async () => {
    post.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    const queryClient = renderPage(<ChangePasswordPage />);

    await fillIn(user, NEW);

    expect(post).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: CURRENT,
      newPassword: NEW,
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/admin/login|${PASSWORD_CHANGED_MESSAGE}`,
      ),
    );
    expect(queryClient.getQueryData(sessionKey)).toBeNull();
  });

  it('reports a rejected current password and stays on the page', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Invalid credentials' } },
      }),
    );
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />);

    await fillIn(user, NEW);

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid credentials/i);
    expect(screen.getByTestId('location').textContent).toBe('/admin/change-password|');
  });
});
