import { createClient } from "@supabase/supabase-js";

// Initialize the Supabase client for the browser (frontend)
// We use the anon key for real-time subscriptions.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
