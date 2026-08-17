// Auto-generiert via: supabase gen types typescript --project-id <id> > src/lib/types/database.ts
// Diese Datei wird nach dem ersten Supabase-Setup überschrieben.
// Bis dahin: manuelle Typen passend zur Migration.

export type UserRole =
  | "admin"
  | "sales"
  | "fulfillment"
  | "client_owner"
  | "client_member";

export type CompanyStatus =
  | "onboarding"
  | "aktiv"
  | "pausiert"
  | "gekuendigt";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  company_id: string | null;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  branche: string | null;
  ansprechpartner: string | null;
  email: string | null;
  telefon: string | null;
  adresse: string | null;
  status: CompanyStatus;
  start_datum: string | null;
  ende_datum: string | null;
  monatliches_retainer: number | null;
  close_lead_id: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

// Supabase Database type — wird durch gen types ersetzt
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id" | "created_at">>;
      };
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Company, "id" | "created_at">>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_staff: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      company_status: CompanyStatus;
    };
  };
}
