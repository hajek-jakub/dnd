import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/auth-context'

export function useProfile() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', user!.id)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useUpdateDisplayName() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const key = ['profile', user?.id]

  return useMutation({
    mutationFn: async (displayName: string) => {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', user!.id)
      if (error) throw error
    },
    // Optimistická aktualizace: jméno se změní hned, při chybě se vrátí.
    onMutate: async (displayName) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<{ id: string; display_name: string }>(key)
      if (previous) queryClient.setQueryData(key, { ...previous, display_name: displayName })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['campaign-members'] })
    },
  })
}
