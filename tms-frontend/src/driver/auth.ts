import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import type { DriverProfile } from '@/shared/auth/types';
import { driverApi, sessionKey } from './api';

export interface PinCredentials {
  driverCode: string;
  pin: string;
}

export function useDriverLogin(): UseMutationResult<DriverProfile, Error, PinCredentials> {
  const queryClient = useQueryClient();

  return useMutation<DriverProfile, Error, PinCredentials>({
    mutationFn: async (credentials) => {
      const { data } = await driverApi.post<{ driver: DriverProfile }>('/auth/login', credentials);

      return data.driver;
    },
    onSuccess: (driver) => {
      queryClient.setQueryData(sessionKey, driver);
    },
  });
}

export function useForgotPin(): UseMutationResult<void, Error, string> {
  return useMutation<void, Error, string>({
    mutationFn: async (driverCode) => {
      await driverApi.post('/auth/forgot-pin', { driverCode });
    },
  });
}
