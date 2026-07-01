import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase environment variables are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
