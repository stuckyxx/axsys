export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_user_id: string
          company_id: string | null
          correlation_id: string
          id: string
          ip_hash: string | null
          metadata: Json
          occurred_at: string
          outcome: Database["public"]["Enums"]["audit_outcome"]
          reason_code: string | null
          resource_id: string | null
          resource_type: string
          scope: Database["public"]["Enums"]["audit_scope"]
          user_agent_hash: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          company_id?: string | null
          correlation_id: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          occurred_at?: string
          outcome: Database["public"]["Enums"]["audit_outcome"]
          reason_code?: string | null
          resource_id?: string | null
          resource_type: string
          scope: Database["public"]["Enums"]["audit_scope"]
          user_agent_hash?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          company_id?: string | null
          correlation_id?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["audit_outcome"]
          reason_code?: string | null
          resource_id?: string | null
          resource_type?: string
          scope?: Database["public"]["Enums"]["audit_scope"]
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          cnpj_normalized: string
          contact_email: string
          contact_phone: string | null
          created_at: string
          id: string
          legal_name: string
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          cnpj_normalized: string
          contact_email: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          legal_name: string
          status?: Database["public"]["Enums"]["company_status"]
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          cnpj_normalized?: string
          contact_email?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          legal_name?: string
          status?: Database["public"]["Enums"]["company_status"]
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "companies_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "company_memberships_suspended_by_fkey"
            columns: ["suspended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "company_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          actor_user_id: string
          company_id: string | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          key_hash: string
          operation: string
          request_hash: string
          response_body: Json | null
          response_status: number | null
          state: Database["public"]["Enums"]["idempotency_state"]
          updated_at: string
        }
        Insert: {
          actor_user_id: string
          company_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          key_hash: string
          operation: string
          request_hash: string
          response_body?: Json | null
          response_status?: number | null
          state?: Database["public"]["Enums"]["idempotency_state"]
          updated_at?: string
        }
        Update: {
          actor_user_id?: string
          company_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          key_hash?: string
          operation?: string
          request_hash?: string
          response_body?: Json | null
          response_status?: number | null
          state?: Database["public"]["Enums"]["idempotency_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "idempotency_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      member_modules: {
        Row: {
          company_id: string
          created_at: string
          granted_by: string | null
          membership_id: string
          module: Database["public"]["Enums"]["module_key"]
        }
        Insert: {
          company_id: string
          created_at?: string
          granted_by?: string | null
          membership_id: string
          module: Database["public"]["Enums"]["module_key"]
        }
        Update: {
          company_id?: string
          created_at?: string
          granted_by?: string | null
          membership_id?: string
          module?: Database["public"]["Enums"]["module_key"]
        }
        Relationships: [
          {
            foreignKeyName: "member_modules_company_id_membership_id_fkey"
            columns: ["company_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "member_modules_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      platform_roles: {
        Row: {
          created_at: string
          created_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "platform_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          email: string
          is_active: boolean
          must_change_password: boolean
          password_changed_at: string | null
          preferred_theme: Database["public"]["Enums"]["theme_preference"]
          temporary_password_expires_at: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          is_active?: boolean
          must_change_password?: boolean
          password_changed_at?: string | null
          preferred_theme?: Database["public"]["Enums"]["theme_preference"]
          temporary_password_expires_at?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          is_active?: boolean
          must_change_password?: boolean
          password_changed_at?: string | null
          preferred_theme?: Database["public"]["Enums"]["theme_preference"]
          temporary_password_expires_at?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      security_events: {
        Row: {
          correlation_id: string
          email_hash: string | null
          event_type: string
          id: string
          ip_hash: string | null
          metadata: Json
          occurred_at: string
          outcome: Database["public"]["Enums"]["audit_outcome"]
          reason_code: string | null
          user_id: string | null
        }
        Insert: {
          correlation_id: string
          email_hash?: string | null
          event_type: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          occurred_at?: string
          outcome: Database["public"]["Enums"]["audit_outcome"]
          reason_code?: string | null
          user_id?: string | null
        }
        Update: {
          correlation_id?: string
          email_hash?: string | null
          event_type?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["audit_outcome"]
          reason_code?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      issue_password_recovery_grant: {
        Args: { p_grant_hash: string }
        Returns: string
      }
    }
    Enums: {
      audit_outcome: "success" | "denied" | "failure"
      audit_scope: "platform" | "tenant"
      company_status: "active" | "archived"
      idempotency_state: "processing" | "completed" | "failed"
      membership_role: "company_admin" | "member"
      membership_status: "active" | "suspended"
      module_key: "administrative" | "financial" | "certificates"
      platform_role: "super_admin"
      theme_preference: "dark" | "light"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_outcome: ["success", "denied", "failure"],
      audit_scope: ["platform", "tenant"],
      company_status: ["active", "archived"],
      idempotency_state: ["processing", "completed", "failed"],
      membership_role: ["company_admin", "member"],
      membership_status: ["active", "suspended"],
      module_key: ["administrative", "financial", "certificates"],
      platform_role: ["super_admin"],
      theme_preference: ["dark", "light"],
    },
  },
} as const
