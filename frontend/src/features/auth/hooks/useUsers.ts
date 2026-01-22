import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService } from '@/features/auth/services/user.service';
import { loginService } from '@/features/login/services/login.service';

interface UseUsersOptions {
  pageSize?: number;
  enabled?: boolean;
  searchQuery?: string;
}

export function useUsers(options: UseUsersOptions = {}) {
  const { pageSize = 20, enabled = true, searchQuery = '' } = options;
  const [currentPage, setCurrentPage] = useState(1);
  const queryClient = useQueryClient();

  // Fetch users data
  const {
    data: usersData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['users', currentPage, searchQuery],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: ((currentPage - 1) * pageSize).toString(),
      });
      // Use the user service to get users with search, backend handles filtering
      return userService.getUsers(params.toString(), searchQuery);
    },
    enabled: enabled,
    placeholderData: (previousData) => previousData, // Keep previous data while loading
  });

  // Pagination calculations
  const totalPages = Math.ceil((usersData?.pagination.total || 0) / pageSize);

  // Get single user
  const getUser = useCallback(async (id: string) => {
    return await userService.getUser(id);
  }, []);

  // Get current user
  const getCurrentUser = useCallback(async () => {
    return await loginService.getCurrentUser();
  }, []);

  // Register user mutation
  const registerMutation = useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name?: string }) =>
      userService.register(email, password, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  // Delete users mutation
  const deleteUsersMutation = useMutation({
    mutationFn: (userIds: string[]) => userService.deleteUsers(userIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return {
    // Data
    users: usersData?.users || [],
    totalUsers: usersData?.pagination.total || 0,
    isLoading,
    error,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    pageSize,

    // Search
    searchQuery,

    // Operations
    refetch,

    // Service methods
    getUser,
    getCurrentUser,
    register: registerMutation.mutateAsync,
    deleteUsers: deleteUsersMutation.mutateAsync,

    // Mutation states
    isRegistering: registerMutation.isPending,
    isDeleting: deleteUsersMutation.isPending,
  };
}
