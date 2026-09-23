import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import axios from 'axios';

import type { LoginChallenge, StaffProfile, TotpEnrolment } from '@/shared/auth/types';
import { adminApi, sessionKey } from './api';

export interface Credentials {
  email: string;
  password: string;
}

export function messageFor(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message;

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}

export function useStaffLogin(): UseMutationResult<LoginChallenge, Error, Credentials> {
  return useMutation<LoginChallenge, Error, Credentials>({
    mutationFn: async (credentials) => {
      const { data } = await adminApi.post<LoginChallenge>('/auth/login', credentials);

      return data;
    },
  });
}

export function useTotpEnrolment(): UseMutationResult<TotpEnrolment, Error, void> {
  return useMutation<TotpEnrolment, Error, void>({
    mutationFn: async () => {
      const { data } = await adminApi.post<TotpEnrolment>('/auth/2fa/enrol');

      return data;
    },
  });
}

export function useTotpVerify(): UseMutationResult<StaffProfile, Error, string> {
  const queryClient = useQueryClient();

  return useMutation<StaffProfile, Error, string>({
    mutationFn: async (code) => {
      const { data } = await adminApi.post<{ user: StaffProfile }>('/auth/2fa/verify', { code });

      return data.user;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKey, user);
    },
  });
}

/** Public: the server answers the same way whatever the address, so there is nothing to read. */
export function useRequestPasswordReset(): UseMutationResult<void, Error, string> {
  return useMutation<void, Error, string>({
    mutationFn: async (email) => {
      await adminApi.post('/auth/forgot-password', { email });
    },
  });
}

export function useResetPassword(): UseMutationResult<
  void,
  Error,
  { token: string; password: string }
> {
  return useMutation<void, Error, { token: string; password: string }>({
    mutationFn: async (input) => {
      await adminApi.post('/auth/reset-password', input);
    },
  });
}
