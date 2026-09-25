import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PinResetRequestsPage } from '@/admin/pages/PinResetRequestsPage';
import { adminApi } from '@/admin/api';

vi.mock('@/admin/api', () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  sessionKey: ['admin', 'session'],
  useSession: vi.fn(),
  useLogout: vi.fn(),
}));

const get = vi.mocked(adminApi.get);
const put = vi.mocked(adminApi.put);

const openRequest = {
  id: 'r1',
  driverId: 'd1',
  driverCode: 'DRV-0001',
  firstName: 'Drew',
  lastName: 'Ives',
  requestedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PinResetRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: [openRequest] });
  });

  it('lists open requests with the driver code and name', async () => {
    renderPage(<PinResetRequestsPage />);

    expect(await screen.findByText('DRV-0001')).toBeInTheDocument();
    expect(screen.getByText('Drew Ives')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/drivers/pin-reset-requests');
  });

  it('sets a new PIN for the requesting driver through the API', async () => {
    put.mockResolvedValue({ data: undefined });
    const user = userEvent.setup();
    renderPage(<PinResetRequestsPage />);

    const row = (await screen.findByText('DRV-0001')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: /set pin/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New PIN for DRV-0001');

    await user.type(within(dialog).getByLabelText(/new pin/i), '918273');
    await user.click(within(dialog).getByRole('button', { name: /change pin/i }));

    expect(put).toHaveBeenCalledWith('/drivers/d1/pin', { pin: '918273' });
  });

  it('tells the user when nothing is open', async () => {
    get.mockResolvedValue({ data: [] });
    renderPage(<PinResetRequestsPage />);

    expect(await screen.findByText(/no open pin requests/i)).toBeInTheDocument();
  });
});
