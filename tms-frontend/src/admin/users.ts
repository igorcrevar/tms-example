import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { adminApi } from './api';

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED';

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string | null;
  isSuperAdmin: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  driver: { id: string; driverCode: string; driverType: string } | null;
}

export interface UserFilters {
  role?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const ROLE_NAMES = ['SUPER_ADMIN', 'ADMIN', 'DRIVER'];

interface PagedUsers {
  items: UserSummary[];
  total: number;
}

const usersKey = (filters: UserFilters) => ['admin', 'users', filters];

export function useUsers(filters: UserFilters): UseQueryResult<PagedUsers> {
  return useQuery<PagedUsers>({
    queryKey: usersKey(filters),
    queryFn: async () => {
      const { data } = await adminApi.get<PagedUsers>('/users', { params: filters });

      return data;
    },
  });
}

function useUsersMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
): UseMutationResult<unknown, Error, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, TVariables>({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export function useInviteUser() {
  return useUsersMutation<InviteInput>((input) => adminApi.post('/invitations', input));
}

/** A fresh link for an invitee whose earlier one expired or never arrived. */
export function useResendInvitation() {
  return useUsersMutation<string>((id) => adminApi.post(`/invitations/${id}/resend`));
}

export function useDeleteUser() {
  return useUsersMutation<string>((id) => adminApi.delete(`/users/${id}`));
}

export interface CreateDriverInput {
  driverCode: string;
  firstName: string;
  lastName: string;
  email: string;
  driverType: 'TRUCK' | 'TRAIN';
  pin: string;
}

export function useCreateDriver() {
  return useUsersMutation<CreateDriverInput>((input) => adminApi.post('/drivers', input));
}

/** For staff who have lost their authenticator: they enrol again at next sign-in. */
export function useResetTwoFactor() {
  return useUsersMutation<string>((id) => adminApi.delete(`/users/${id}/two-factor`));
}

export interface PinResetRequest {
  id: string;
  driverId: string;
  driverCode: string;
  firstName: string;
  lastName: string;
  requestedAt: string;
}

const pinResetRequestsKey = ['admin', 'pin-requests'];

/** Polled, since a driver's request arrives with no push channel. */
export function usePinResetRequests(): UseQueryResult<PinResetRequest[]> {
  return useQuery<PinResetRequest[]>({
    queryKey: pinResetRequestsKey,
    queryFn: async () => {
      const { data } = await adminApi.get<PinResetRequest[]>('/drivers/pin-reset-requests');

      return data;
    },
    refetchInterval: 30_000,
  });
}

/** A new PIN also resolves the driver's open reset request. */
export function useSetDriverPin() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { driverId: string; pin: string }>({
    mutationFn: ({ driverId, pin }) => adminApi.put(`/drivers/${driverId}/pin`, { pin }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
        queryClient.invalidateQueries({ queryKey: pinResetRequestsKey }),
      ]),
  });
}
