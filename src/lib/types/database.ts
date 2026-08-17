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

export type LeadStatus =
  | "neu"
  | "kontaktiert"
  | "termin_vereinbart"
  | "vor_ort_termin"
  | "angebot_raus"
  | "gewonnen"
  | "verloren"
  | "kein_interesse"
  | "nicht_erreicht";

export type LeadQuelle = "google_ads" | "onepage" | "manuell" | "empfehlung";

export type LeadActivityTyp =
  | "anruf"
  | "notiz"
  | "status_wechsel"
  | "email"
  | "whatsapp";

export type VerlustGrund =
  | "zu_teuer"
  | "kein_bedarf_mehr"
  | "anderer_anbieter"
  | "nicht_erreicht"
  | "unpassende_anfrage";

export type SlaAmpel = "gruen" | "gelb" | "rot";

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

export interface Lead {
  id: string;
  company_id: string;
  vorname: string;
  nachname: string;
  telefon: string | null;
  email: string | null;
  plz: string | null;
  ort: string | null;
  anliegen: string | null;
  quelle: LeadQuelle;
  campaign: string | null;
  form_payload: Record<string, unknown> | null;
  created_at: string;
  first_contact_at: string | null;
  status: LeadStatus;
  assigned_to: string | null;
  angebotswert: number | null;
  auftragswert: number | null;
  verlust_grund: VerlustGrund | null;
  naechste_aktion_am: string | null;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  user_id: string | null;
  typ: LeadActivityTyp;
  inhalt: string | null;
  alt_status: LeadStatus | null;
  neu_status: LeadStatus | null;
  created_at: string;
}

export interface LeadSla {
  id: string;
  company_id: string;
  vorname: string;
  nachname: string;
  status: LeadStatus;
  created_at: string;
  first_contact_at: string | null;
  reaktionszeit_minuten: number;
  ampel: SlaAmpel;
}

export interface WebhookError {
  id: string;
  endpoint: string;
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface CompanyFormMapping {
  id: string;
  company_id: string;
  form_id: string;
  campaign: string | null;
  created_at: string;
}

// Supabase Database type — wird durch gen types ersetzt
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      companies: {
        Row: Company;
        Insert: Partial<Company> & { name: string };
        Update: Partial<Company>;
        Relationships: [];
      };
      leads: {
        Row: Lead;
        Insert: Partial<Lead> & { company_id: string };
        Update: Partial<Lead>;
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey";
            columns: ["company_id"];
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_activities: {
        Row: LeadActivity;
        Insert: Partial<LeadActivity> & { lead_id: string; typ: LeadActivityTyp };
        Update: Partial<LeadActivity>;
        Relationships: [];
      };
      webhook_errors: {
        Row: WebhookError;
        Insert: Partial<WebhookError> & { endpoint: string };
        Update: Partial<WebhookError>;
        Relationships: [];
      };
      company_form_mappings: {
        Row: CompanyFormMapping;
        Insert: Partial<CompanyFormMapping> & {
          company_id: string;
          form_id: string;
        };
        Update: Partial<CompanyFormMapping>;
        Relationships: [];
      };
    };
    Views: {
      lead_sla: {
        Row: LeadSla;
        Relationships: [];
      };
    };
    Functions: {
      is_staff: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      company_status: CompanyStatus;
      lead_status: LeadStatus;
      lead_quelle: LeadQuelle;
      lead_activity_typ: LeadActivityTyp;
      verlust_grund: VerlustGrund;
    };
    CompositeTypes: Record<string, never>;
  };
}
