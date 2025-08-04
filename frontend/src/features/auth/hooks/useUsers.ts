import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authService } from '@/features/auth/services/auth.service';
import { metadataService } from '@/features/dashboard/services/metadata.service';

interface UseUsersOptions {
  pageSize?: number;
  enabled?: boolean;
  searchQuery?: string;
}

export function useUsers(options: UseUsersOptions = {}) {
  const { pageSize = 20, enabled = true, searchQuery = '' } = options;
  const [currentPage, setCurrentPage] = useState(1);

  // Ensure API key is fetched
  const { data: apiKey } = useQuery({
    queryKey: ['apiKey'],
    queryFn: () => metadataService.fetchApiKey(),
    staleTime: Infinity,
  });

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
      // Use the auth service to get users with search, backend handles filtering
      return authService.getUsers(params.toString(), searchQuery);
    },
    enabled: enabled && !!apiKey,
    placeholderData: (previousData) => previousData, // Keep previous data while loading
  });

  // No need for client-side filtering - backend handles search
  const filteredUsers = usersData?.records || [];

  // Pagination calculations
  const totalPages = Math.ceil((usersData?.total || 0) / pageSize);
  const startRecord = (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, usersData?.total || 0);

  return {
    // Data
    users: filteredUsers,
    totalUsers: usersData?.total || 0,
    isLoading,
    error,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    startRecord,
    endRecord,
    pageSize,

    // Search
    searchQuery,

    // Operations
    refetch,
  };
}
