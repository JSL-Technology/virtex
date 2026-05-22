export function hasPermission(
  userPermissions: string[] | undefined | null,
  requiredPermissions: string[]
): boolean {
  if (!userPermissions) {
    return false;
  }

  // Super-admin wildcard
  if (userPermissions.includes('*')) {
    return true;
  }

  // Check if every required permission is satisfied
  return requiredPermissions.every((req) =>
    userPermissions.some((userPerm) => {
      // Exact match
      if (userPerm === req) {
        return true;
      }
      // Wildcard match (e.g. 'sales.*' matches 'sales.create')
      if (userPerm.endsWith('*')) {
        const prefix = userPerm.slice(0, -1); // 'sales.'
        return req.startsWith(prefix);
      }
      return false;
    })
  );
}
