"use client";

import { useState } from "react";
import { useFetch } from "./useFetch";
import {
  fetchConfiguration,
  updateConfiguration,
} from "@/lib/api";
import type {
  Configuration,
  ConfigCategory,
  ConfigValue,
} from "@/types/configuration";

interface UseConfigurationResult {
  config: Configuration[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  save: (category: ConfigCategory, key: string, value: ConfigValue) => Promise<void>;
  refetch: () => void;
}

export function useConfiguration(
  category?: ConfigCategory
): UseConfigurationResult {
  const [saving, setSaving] = useState(false);
  const { data, loading, error, refetch } = useFetch<Configuration[]>(
    () => fetchConfiguration(category),
    [category]
  );

  const save = async (
    cat: ConfigCategory,
    key: string,
    value: ConfigValue
  ) => {
    setSaving(true);
    try {
      await updateConfiguration(cat, key, value);
      refetch();
    } finally {
      setSaving(false);
    }
  };

  return {
    config: data ?? [],
    loading,
    error,
    saving,
    save,
    refetch,
  };
}
