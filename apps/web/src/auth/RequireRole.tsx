import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { User } from './auth-api';

type RequireRoleProps = {
  user: User;
  allowedRoles: User['role'][];
  children: ReactNode;
};

export function RequireRole({
  user,
  allowedRoles,
  children,
}: RequireRoleProps) {
  if (!allowedRoles.includes(user.role)) {
    return (
      <section>
        <h1>Access denied</h1>
        <p>You do not have permission to view this page.</p>
        <Link to="/">Return home</Link>
      </section>
    );
  }

  return <>{children}</>;
}