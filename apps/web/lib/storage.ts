import { SupabaseAdapter } from "@syc/storage";

import { LocalStorageAdapter, type AppStorageAdapter } from "@/lib/local-storage-adapter";
import { createSupabaseServerClient } from "@/lib/supabase-server-client";

let localAdapterSingleton: LocalStorageAdapter | null = null;
let supabaseAdapterSingleton: SupabaseAdapter | null = null;

function hasSupabaseEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function allowLocalStorageFallback(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ALLOW_LOCAL_STORAGE_FALLBACK === "true";
}

export function createStorageAdapter(): AppStorageAdapter {
  if (hasSupabaseEnv()) {
    if (!supabaseAdapterSingleton) {
      supabaseAdapterSingleton = new SupabaseAdapter(createSupabaseServerClient());
    }
    return supabaseAdapterSingleton;
  }

  if (!allowLocalStorageFallback()) {
    throw new Error(
      "Supabase credentials are required. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Local file storage fallback is only available when ALLOW_LOCAL_STORAGE_FALLBACK=true or during tests."
    );
  }

  if (!localAdapterSingleton) {
    localAdapterSingleton = new LocalStorageAdapter();
  }
  return localAdapterSingleton;
}

export async function prepareStorage(storage: AppStorageAdapter): Promise<void> {
  if (hasSupabaseEnv()) {
    return;
  }

  await storage.ensureSchema();
}
