import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from '@/admin/pages/UsersPage';
import { adminApi } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const get = vi.mocked(adminApi.get);
const post = vi.mocked(adminApi.post);
const del = vi.mocked(adminApi.delete);

const staffUser = {
  id: 'u1',
  email: 'staff@tms.local',
  firstName: 'Sam',
  lastName: 'Staff',
  role: 'ADMIN',
  isSuperAdmin: false,
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  driver: null,
};

const driverUser = {
  ...staffUser,
  id: 'u2',
  email: 'driver@tms.local',
  firstName: 'Drew',
  lastName: 'Ives',
  role: 'DRIVER',
  driver: { id: 'd1', driverCode: 'DRV-0001', driverType: 'TRUCK' },
};

const invitedUser = {
  ...staffUser,
  id: 'u3',
  email: 'invited@tms.local',
  firstName: 'Ivy',
  lastName: 'Newcomer',
  status: 'INVITED',
};

const superAdminUser = {
  ...staffUser,
  id: 'u4',
  email: 'root@tms.local',
  firstName: 'Rae',
  lastName: 'Root',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
};

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { items: [staffUser, driverUser, invitedUser], total: 3 } });
  });

  it('lists users with their role and status', async () => {
    renderPage(<UsersPage />);

    expect(await screen.findByText('staff@tms.local')).toBeInTheDocument();
    expect(screen.getByText('driver@tms.local')).toBeInTheDocument();
    expect(screen.getAllByText('ACTIVE')).toHaveLength(2);
    expect(screen.getByText('INVITED')).toBeInTheDocument();
  });

  it('asks the API for drivers only when the filter changes', async () => {
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    await screen.findByText('staff@tms.local');
    expect(get).toHaveBeenLastCalledWith('/users', { params: { page: 1, limit: 25 } });

    await user.click(screen.getByRole('button', { name: 'DRIVER' }));

    expect(get).toHaveBeenLastCalledWith('/users', {
      params: { role: 'DRIVER', page: 1, limit: 25 },
    });
  });

  it('asks the API for the next page and shows the total', async () => {
    get.mockResolvedValue({ data: { items: [staffUser, driverUser], total: 60 } });
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    await screen.findByText('staff@tms.local');
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next page/i }));

    expect(get).toHaveBeenLastCalledWith('/users', { params: { page: 2, limit: 25 } });
  });

  it('offers a PIN change for drivers and not for staff', async () => {
    renderPage(<UsersPage />);

    const driverRow = (await screen.findByText('driver@tms.local')).closest('tr');
    const staffRow = screen.getByText('staff@tms.local').closest('tr');

    expect(within(driverRow!).getByRole('button', { name: /change pin/i })).toBeInTheDocument();
    expect(within(staffRow!).queryByRole('button', { name: /change pin/i })).toBeNull();
  });

  it('offers a two-factor reset for staff and not for drivers', async () => {
    renderPage(<UsersPage />);

    const staffRow = (await screen.findByText('staff@tms.local')).closest('tr');
    const driverRow = screen.getByText('driver@tms.local').closest('tr');

    expect(within(staffRow!).getByRole('button', { name: /reset 2fa/i })).toBeInTheDocument();
    expect(within(driverRow!).queryByRole('button', { name: /reset 2fa/i })).toBeNull();
  });

  it('offers a resend only to invitees and a two-factor reset only to active staff', async () => {
    renderPage(<UsersPage />);

    const invitedRow = (await screen.findByText('invited@tms.local')).closest('tr');
    const staffRow = screen.getByText('staff@tms.local').closest('tr');

    expect(
      within(invitedRow!).getByRole('button', { name: /resend invitation/i }),
    ).toBeInTheDocument();
    expect(within(invitedRow!).queryByRole('button', { name: /reset 2fa/i })).toBeNull();
    expect(within(staffRow!).queryByRole('button', { name: /resend invitation/i })).toBeNull();
  });

  it('resends the invitation through the API and confirms it', async () => {
    post.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    const invitedRow = (await screen.findByText('invited@tms.local')).closest('tr');
    await user.click(within(invitedRow!).getByRole('button', { name: /resend invitation/i }));

    expect(post).toHaveBeenCalledWith('/invitations/u3/resend');
    expect(await screen.findByRole('status')).toHaveTextContent('invited@tms.local');
  });

  it('resets two-factor through the API once confirmed', async () => {
    del.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    const staffRow = (await screen.findByText('staff@tms.local')).closest('tr');
    await user.click(within(staffRow!).getByRole('button', { name: /reset 2fa/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('staff@tms.local');

    await user.click(within(dialog).getByRole('button', { name: /^reset 2fa$/i }));

    expect(del).toHaveBeenCalledWith('/users/u1/two-factor');
  });

  it('does not offer to delete a super admin', async () => {
    get.mockResolvedValue({ data: { items: [staffUser, superAdminUser], total: 2 } });
    renderPage(<UsersPage />);

    const superRow = (await screen.findByText('root@tms.local')).closest('tr');
    const staffRow = screen.getByText('staff@tms.local').closest('tr');

    expect(within(superRow!).queryByRole('button', { name: /delete/i })).toBeNull();
    expect(within(staffRow!).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    const staffRow = (await screen.findByText('staff@tms.local')).closest('tr');
    await user.click(within(staffRow!).getByRole('button', { name: /delete/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('staff@tms.local');
    expect(del).not.toHaveBeenCalled();
  });

  it('soft-deletes through the API once confirmed', async () => {
    del.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    const staffRow = (await screen.findByText('staff@tms.local')).closest('tr');
    await user.click(within(staffRow!).getByRole('button', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(del).toHaveBeenCalledWith('/users/u1');
  });

  it('reports a refused delete instead of failing silently', async () => {
    del.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Insufficient permissions' } },
      }),
    );
    const user = userEvent.setup();
    renderPage(<UsersPage />);

    const staffRow = (await screen.findByText('staff@tms.local')).closest('tr');
    await user.click(within(staffRow!).getByRole('button', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
  });

  it('tells the user when nothing matches', async () => {
    get.mockResolvedValue({ data: { items: [], total: 0 } });
    renderPage(<UsersPage />);

    expect(await screen.findByText(/no users match this filter/i)).toBeInTheDocument();
  });

  it('emails the selected users and clears the selection', async () => {
    post.mockResolvedValue({ data: { sent: 2, failed: [] } });
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('staff@tms.local');

    expect(screen.getByRole('button', { name: 'Email selected (0)' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select staff@tms.local' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select driver@tms.local' }));
    await user.click(screen.getByRole('button', { name: 'Email selected (2)' }));

    await user.type(screen.getByRole('textbox', { name: /subject/i }), 'Maintenance');
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'Down at noon.');
    await user.click(screen.getByRole('button', { name: 'Send email' }));

    expect(post).toHaveBeenCalledWith('/users/mass-email', {
      userIds: ['u1', 'u2'],
      subject: 'Maintenance',
      body: 'Down at noon.',
    });
    expect(await screen.findByText('Email sent to 2 users')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Email selected (0)' })).toBeDisabled();
  });

  it('keeps the failed recipients selected and reports them', async () => {
    post.mockResolvedValue({ data: { sent: 1, failed: [{ userId: 'u2' }] } });
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('staff@tms.local');

    await user.click(screen.getByRole('checkbox', { name: 'Select staff@tms.local' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select driver@tms.local' }));
    await user.click(screen.getByRole('button', { name: 'Email selected (2)' }));
    await user.type(screen.getByRole('textbox', { name: /subject/i }), 's');
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'b');
    await user.click(screen.getByRole('button', { name: 'Send email' }));

    expect(
      within(await screen.findByRole('alert')).getByText(
        'The email reached 1 of 2 users; 1 failed. Those users are still selected.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Email sent to/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select staff@tms.local' })).not.toBeChecked();
    expect(await screen.findByRole('button', { name: 'Email selected (1)' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Select driver@tms.local' })).toBeChecked();
  });

  it('selects every user on the page at once', async () => {
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('staff@tms.local');

    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

    expect(screen.getByRole('button', { name: 'Email selected (3)' })).toBeEnabled();
  });

  it('disables sending above 100 selected users', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      ...staffUser,
      id: `u${i}`,
      email: `u${i}@tms.local`,
    }));
    get.mockResolvedValue({ data: { items: many, total: 101 } });
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('u0@tms.local');

    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

    expect(screen.getByRole('button', { name: 'Email selected (101, max 100)' })).toBeDisabled();
  }, 20000);

  it('keeps the selection across pages', async () => {
    get.mockResolvedValue({ data: { items: [staffUser, driverUser], total: 60 } });
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('staff@tms.local');

    await user.click(screen.getByRole('checkbox', { name: 'Select staff@tms.local' }));
    await user.click(screen.getByRole('button', { name: /next page/i }));

    expect(await screen.findByRole('button', { name: 'Email selected (1)' })).toBeEnabled();
  });

  it('drops a deleted user from the selection', async () => {
    del.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage(<UsersPage />);
    await screen.findByText('staff@tms.local');

    await user.click(screen.getByRole('checkbox', { name: 'Select staff@tms.local' }));
    const row = screen.getByText('staff@tms.local').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('button', { name: 'Email selected (0)' })).toBeDisabled();
  });
});
