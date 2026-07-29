"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "@/lib/i18n";
import { fetchUsers, createUser, updateUser, deactivateUser } from "@/lib/api";
import type { User, UserCreatePayload, UserRole } from "@/types/auth";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  superadmin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  user: "bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-400",
};

export default function AdminPage() {
  const { user: currentUser, isSuperadmin } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [formEmail, setFormEmail] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("user");

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchUsers();
      setUsers(data);
      setError(null);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperadmin) {
      loadUsers();
    }
  }, [isSuperadmin]);

  // Redirect non-superadmin users
  useEffect(() => {
    if (currentUser && !isSuperadmin) {
      router.replace("/");
    }
  }, [currentUser, isSuperadmin, router]);

  if (!isSuperadmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--text-tertiary)]">{t("admin.noAccess")}</p>
      </div>
    );
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);

    try {
      const payload: UserCreatePayload = {
        email: formEmail,
        password: formPassword,
        name: formName,
        role: formRole,
      };
      await createUser(payload);
      setFormEmail("");
      setFormName("");
      setFormPassword("");
      setFormRole("user");
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleChangeRole = async (u: User, newRole: UserRole) => {
    try {
      await updateUser(u.id, { role: newRole });
      await loadUsers();
    } catch {
      // Silently handled - user list will reflect current state
    }
  };

  const handleToggleActive = async (u: User) => {
    try {
      if (u.is_active) {
        await deactivateUser(u.id);
      } else {
        await updateUser(u.id, { is_active: true });
      }
      await loadUsers();
    } catch {
      // Silently handled
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          {t("admin.title")}
        </h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-radar-600 px-4 py-2 text-sm font-semibold text-white hover:bg-radar-700 transition-colors"
        >
          {showForm ? t("common.cancel") : t("admin.addUser")}
        </button>
      </div>

      {/* Create user form */}
      {showForm && (
        <Card>
          <CardBody>
            {formError && (
              <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
                {formError}
              </div>
            )}
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="new-email" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  {t("admin.email")}
                </label>
                <input
                  id="new-email"
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                />
              </div>
              <div>
                <label htmlFor="new-name" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  {t("admin.name")}
                </label>
                <input
                  id="new-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                />
              </div>
              <div>
                <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  {t("admin.password")}
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={6}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label htmlFor="new-role" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                    {t("admin.role")}
                  </label>
                  <select
                    id="new-role"
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                  >
                    <option value="user">{t("role.user")}</option>
                    <option value="admin">{t("role.admin")}</option>
                    <option value="superadmin">{t("role.superadmin")}</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-md bg-radar-600 px-4 py-2 text-sm font-semibold text-white hover:bg-radar-700 disabled:opacity-50 transition-colors"
                >
                  {creating ? t("admin.creating") : t("admin.create")}
                </button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Users table */}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-500 border-t-transparent" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {users.length} users
            </h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="px-6 py-3 text-left font-medium text-[var(--text-tertiary)]">{t("admin.name")}</th>
                  <th className="px-6 py-3 text-left font-medium text-[var(--text-tertiary)]">{t("admin.email")}</th>
                  <th className="px-6 py-3 text-center font-medium text-[var(--text-tertiary)]">{t("admin.role")}</th>
                  <th className="px-6 py-3 text-center font-medium text-[var(--text-tertiary)]">{t("admin.isActive")}</th>
                  <th className="px-6 py-3 text-right font-medium text-[var(--text-tertiary)]">{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border-primary)] last:border-b-0">
                    <td className="px-6 py-3 text-[var(--text-primary)]">{u.name}</td>
                    <td className="px-6 py-3 text-[var(--text-secondary)]">{u.email}</td>
                    <td className="px-6 py-3 text-center">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_STYLES[u.role]}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          u.is_active ? "bg-green-500" : "bg-red-400"
                        }`}
                      />
                    </td>
                    <td className="px-6 py-3 text-right">
                      {u.id !== currentUser?.id && (
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={u.role}
                            onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none"
                          >
                            <option value="user">{t("role.user")}</option>
                            <option value="admin">{t("role.admin")}</option>
                            <option value="superadmin">{t("role.superadmin")}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            className={`rounded px-2 py-1 text-xs transition-colors ${
                              u.is_active
                                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                : "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                            }`}
                          >
                            {u.is_active ? t("admin.deactivate") : t("admin.activate")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
