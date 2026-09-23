import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

export function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export interface SessionHooks<TProfile> {
  sessionKey: string[];
  useSession: () => UseQueryResult<TProfile | null>;
  useLogout: () => UseMutationResult<void, Error, void>;
}

/**
 * The session lives in HttpOnly cookies, so the client cannot read it — the
 * server is asked who the caller is instead.
 */
export function createSessionHooks<TProfile>(
  client: AxiosInstance,
  scope: string,
): SessionHooks<TProfile> {
  const sessionKey = [scope, 'session'];

  function useSession(): UseQueryResult<TProfile | null> {
    return useQuery<TProfile | null>({
      queryKey: sessionKey,
      queryFn: async () => {
        try {
          const { data } = await client.get<TProfile>('/auth/me');

          return data;
        } catch (error) {
          if (isUnauthorized(error)) {
            return null;
          }

          throw error;
        }
      },
      retry: false,
      staleTime: 60_000,
    });
  }

  function useLogout(): UseMutationResult<void, Error, void> {
    const queryClient = useQueryClient();

    return useMutation<void, Error, void>({
      mutationFn: async () => {
        await client.post('/auth/logout');
      },
      onSettled: () => {
        queryClient.setQueryData(sessionKey, null);
      },
    });
  }

  return { sessionKey, useSession, useLogout };
}
