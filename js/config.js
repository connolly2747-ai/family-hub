// Public-by-design values (safe to commit): the Supabase publishable key only works
// within the Row Level Security rules defined in supabase/schema.sql.
export const SUPABASE_URL = "https://esgbgmchgibkstywbeox.supabase.co";
export const SUPABASE_KEY = "sb_publishable_NgGeFw5s8K3RtyjUy1ujJA_riBi23BR";
// The shared family login. The "family code" is this account's password.
export const FAMILY_EMAIL = "family@connollyfamilyhub.com";
// Who can change wish-list ticket statuses (UI convenience; the data itself is protected by the shared family login).
export const ADMIN_IDS = ["kevin"];
