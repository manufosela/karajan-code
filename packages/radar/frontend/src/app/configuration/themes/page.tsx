"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { fetchActiveProfile } from "@/lib/api";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ActiveProfile, ProfileTerm } from "@/types/profile";

function TermList({ title, terms }: { title: string; terms: ProfileTerm[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <span className="text-2xs text-[var(--text-tertiary)]">{terms.length}</span>
      </div>
      <dl className="mt-3 space-y-3">
        {terms.map((term) => (
          <div key={term.id}>
            <dt className="text-xs font-medium text-[var(--text-primary)]">
              {term.label}
              <code className="ml-2 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-2xs text-[var(--text-tertiary)]">
                {term.id}
              </code>
            </dt>
            <dd className="mt-0.5 text-xs text-[var(--text-secondary)]">{term.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ThemesPage() {
  const [profile, setProfile] = useState<ActiveProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveProfile()
      .then(setProfile)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/configuration" className="hover:text-radar-600 transition-colors">
          Configuration
        </Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Temáticas</span>
      </div>

      <div>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">Temáticas del radar</h1>
        {profile && (
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Perfil activo: <code>{profile.id}</code> · {profile.name}
          </p>
        )}
      </div>

      {loading && <LoadingState />}

      {error && !loading && (
        <EmptyState title="No se pudo cargar el perfil" description={error} />
      )}

      {profile && !loading && (
        <div className="space-y-4">
          <TermList title="Temas" terms={profile.taxonomy.themes} />
          <TermList title="Buckets estratégicos" terms={profile.taxonomy.strategic_buckets} />
          <TermList title="Horizontes temporales" terms={profile.taxonomy.time_horizons} />

          {profile.taxonomy.keywords.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Keywords</h3>
                <span className="text-2xs text-[var(--text-tertiary)]">
                  {profile.taxonomy.keywords.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.taxonomy.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-md bg-[var(--bg-tertiary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-2xs text-[var(--text-tertiary)]">
            Esta taxonomía se define en el Radar Profile del backend. Editarla
            desde la interfaz aún no está soportado.
          </p>
        </div>
      )}
    </div>
  );
}
