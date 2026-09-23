import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { adminApi } from './api';

export interface InvitationPreview {
  email: string;
  firstName: string;
  expiresAt: string;
}

/** Public endpoint: the accept page runs without a session. */
export function useInvitationPreview(token: string): UseQueryResult<InvitationPreview> {
  return useQuery<InvitationPreview>({
    queryKey: ['invitation', token],
    enabled: token.length > 0,
    retry: false,
    queryFn: async () => {
      const { data } = await adminApi.get<InvitationPreview>('/invitations/preview', {
        params: { token },
      });

      return data;
    },
  });
}

export function useAcceptInvitation(): UseMutationResult<
  void,
  Error,
  { token: string; password: string }
> {
  return useMutation<void, Error, { token: string; password: string }>({
    mutationFn: async (input) => {
      await adminApi.post('/invitations/accept', input);
    },
  });
}
