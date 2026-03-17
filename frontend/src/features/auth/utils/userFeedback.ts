export function formatDeleteUsersToastMessage(
  requestedCount: number,
  deletedCount: number
): string {
  if (deletedCount <= 0) {
    return 'No users were deleted';
  }

  if (deletedCount < requestedCount) {
    return `${deletedCount} of ${requestedCount} users deleted successfully`;
  }

  return `${deletedCount} user${deletedCount === 1 ? '' : 's'} deleted successfully`;
}
