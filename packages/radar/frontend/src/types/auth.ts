/**
 * Valid user roles in hierarchical order.
 */
export type UserRole = "superadmin" | "admin" | "user";

/**
 * User information returned by the API.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

/**
 * Response from /auth/login.
 */
export interface LoginResponse {
  token: string;
  user: User;
}

/**
 * Payload for creating a new user (superadmin action).
 */
export interface UserCreatePayload {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

/**
 * Payload for updating a user (superadmin action).
 */
export interface UserUpdatePayload {
  name?: string;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

/**
 * Active user info returned by /auth/active-users.
 */
export interface ActiveUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  last_active_at: string | null;
}
