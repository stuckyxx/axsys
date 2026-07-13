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
          actor_user_id: string | null
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
          actor_user_id?: string | null
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
          actor_user_id?: string | null
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
      catalog_items: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          company_id: string
          created_at: string
          created_by: string
          description: string
          id: string
          item_kind: Database["public"]["Enums"]["catalog_item_kind"]
          name: string
          segment: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          description: string
          id?: string
          item_kind: Database["public"]["Enums"]["catalog_item_kind"]
          name: string
          segment: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          item_kind?: Database["public"]["Enums"]["catalog_item_kind"]
          name?: string
          segment?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_street: string | null
          archived_at: string | null
          archived_by: string | null
          cnpj_normalized: string
          company_id: string
          created_at: string
          created_by: string
          email: string | null
          id: string
          legal_name: string
          municipality: string
          phone: string | null
          postal_code: string | null
          segment: string
          state: string
          trade_name: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_street?: string | null
          archived_at?: string | null
          archived_by?: string | null
          cnpj_normalized: string
          company_id: string
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          legal_name: string
          municipality: string
          phone?: string | null
          postal_code?: string | null
          segment: string
          state: string
          trade_name?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_street?: string | null
          archived_at?: string | null
          archived_by?: string | null
          cnpj_normalized?: string
          company_id?: string
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          legal_name?: string
          municipality?: string
          phone?: string | null
          postal_code?: string | null
          segment?: string
          state?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
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
      company_bank_accounts: {
        Row: {
          account_ciphertext: string
          account_iv: string
          account_key_version: number
          account_last4: string
          account_tag: string
          account_type: Database["public"]["Enums"]["bank_account_type"]
          archived_at: string | null
          bank_code: string
          bank_name: string
          branch_ciphertext: string
          branch_iv: string
          branch_key_version: number
          branch_last4: string
          branch_tag: string
          company_id: string
          created_at: string
          created_by: string
          holder_document_ciphertext: string | null
          holder_document_iv: string | null
          holder_document_key_version: number | null
          holder_document_last4: string | null
          holder_document_tag: string | null
          holder_name: string
          id: string
          is_default: boolean
          status: Database["public"]["Enums"]["bank_account_status"]
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          account_ciphertext: string
          account_iv: string
          account_key_version: number
          account_last4: string
          account_tag: string
          account_type: Database["public"]["Enums"]["bank_account_type"]
          archived_at?: string | null
          bank_code: string
          bank_name: string
          branch_ciphertext: string
          branch_iv: string
          branch_key_version: number
          branch_last4: string
          branch_tag: string
          company_id: string
          created_at?: string
          created_by: string
          holder_document_ciphertext?: string | null
          holder_document_iv?: string | null
          holder_document_key_version?: number | null
          holder_document_last4?: string | null
          holder_document_tag?: string | null
          holder_name: string
          id?: string
          is_default?: boolean
          status?: Database["public"]["Enums"]["bank_account_status"]
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          account_ciphertext?: string
          account_iv?: string
          account_key_version?: number
          account_last4?: string
          account_tag?: string
          account_type?: Database["public"]["Enums"]["bank_account_type"]
          archived_at?: string | null
          bank_code?: string
          bank_name?: string
          branch_ciphertext?: string
          branch_iv?: string
          branch_key_version?: number
          branch_last4?: string
          branch_tag?: string
          company_id?: string
          created_at?: string
          created_by?: string
          holder_document_ciphertext?: string | null
          holder_document_iv?: string | null
          holder_document_key_version?: number | null
          holder_document_last4?: string | null
          holder_document_tag?: string | null
          holder_name?: string
          id?: string
          is_default?: boolean
          status?: Database["public"]["Enums"]["bank_account_status"]
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_bank_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "company_bank_accounts_updated_by_fkey"
            columns: ["updated_by"]
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
      company_settings: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_postal_code: string | null
          address_state: string | null
          address_street: string | null
          company_id: string
          consolidated_address: string | null
          letterhead_file_id: string | null
          representative_document_ciphertext: string | null
          representative_document_iv: string | null
          representative_document_key_version: number | null
          representative_document_last4: string | null
          representative_document_tag: string | null
          representative_name: string | null
          representative_role: string | null
          signature_file_id: string | null
          tax_rate: number
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          address_street?: string | null
          company_id: string
          consolidated_address?: never
          letterhead_file_id?: string | null
          representative_document_ciphertext?: string | null
          representative_document_iv?: string | null
          representative_document_key_version?: number | null
          representative_document_last4?: string | null
          representative_document_tag?: string | null
          representative_name?: string | null
          representative_role?: string | null
          signature_file_id?: string | null
          tax_rate?: number
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          address_street?: string | null
          company_id?: string
          consolidated_address?: never
          letterhead_file_id?: string | null
          representative_document_ciphertext?: string | null
          representative_document_iv?: string | null
          representative_document_key_version?: number | null
          representative_document_last4?: string | null
          representative_document_tag?: string | null
          representative_name?: string | null
          representative_role?: string | null
          signature_file_id?: string | null
          tax_rate?: number
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_company_id_letterhead_file_id_fkey"
            columns: ["company_id", "letterhead_file_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "company_settings_company_id_signature_file_id_fkey"
            columns: ["company_id", "signature_file_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      company_settings_drafts: {
        Row: {
          base_version: number
          company_id: string
          payload: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          base_version: number
          company_id: string
          payload?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          base_version?: number
          company_id?: string
          payload?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      file_objects: {
        Row: {
          archived_at: string | null
          bucket: string
          byte_size: number
          company_id: string
          created_at: string
          created_by: string
          detected_mime: string
          id: string
          object_path: string
          original_name: string
          owner_user_id: string | null
          promoted_at: string | null
          purpose: Database["public"]["Enums"]["file_purpose"]
          quota_released_at: string | null
          retirement_claim_id: string | null
          retirement_claimed_at: string | null
          retirement_not_before: string | null
          scan_status: Database["public"]["Enums"]["file_scan_status"]
          sha256: string
          status: Database["public"]["Enums"]["file_status"]
          storage_deleted_at: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket: string
          byte_size: number
          company_id: string
          created_at?: string
          created_by: string
          detected_mime: string
          id?: string
          object_path: string
          original_name: string
          owner_user_id?: string | null
          promoted_at?: string | null
          purpose: Database["public"]["Enums"]["file_purpose"]
          quota_released_at?: string | null
          retirement_claim_id?: string | null
          retirement_claimed_at?: string | null
          retirement_not_before?: string | null
          scan_status: Database["public"]["Enums"]["file_scan_status"]
          sha256: string
          status: Database["public"]["Enums"]["file_status"]
          storage_deleted_at?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket?: string
          byte_size?: number
          company_id?: string
          created_at?: string
          created_by?: string
          detected_mime?: string
          id?: string
          object_path?: string
          original_name?: string
          owner_user_id?: string | null
          promoted_at?: string | null
          purpose?: Database["public"]["Enums"]["file_purpose"]
          quota_released_at?: string | null
          retirement_claim_id?: string | null
          retirement_claimed_at?: string | null
          retirement_not_before?: string | null
          scan_status?: Database["public"]["Enums"]["file_scan_status"]
          sha256?: string
          status?: Database["public"]["Enums"]["file_status"]
          storage_deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_objects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_objects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "file_objects_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      file_upload_intents: {
        Row: {
          actor_user_id: string
          authorization_cleanup_claim_id: string | null
          authorization_cleanup_claimed_at: string | null
          authorization_issued_at: string | null
          authorization_retired_at: string | null
          cleanup_error_code: string | null
          cleanup_not_before: string | null
          company_id: string
          created_at: string
          declared_mime: string
          declared_name: string
          declared_size: number
          file_object_id: string | null
          id: string
          purpose: Database["public"]["Enums"]["file_purpose"]
          quarantine_object_path: string
          quota_hold_bytes: number
          status: Database["public"]["Enums"]["upload_intent_status"]
          target_resource_id: string | null
          updated_at: string
          upload_authorization_expires_at: string | null
          version: number
        }
        Insert: {
          actor_user_id: string
          authorization_cleanup_claim_id?: string | null
          authorization_cleanup_claimed_at?: string | null
          authorization_issued_at?: string | null
          authorization_retired_at?: string | null
          cleanup_error_code?: string | null
          cleanup_not_before?: string | null
          company_id: string
          created_at?: string
          declared_mime: string
          declared_name: string
          declared_size: number
          file_object_id?: string | null
          id?: string
          purpose: Database["public"]["Enums"]["file_purpose"]
          quarantine_object_path: string
          quota_hold_bytes: number
          status?: Database["public"]["Enums"]["upload_intent_status"]
          target_resource_id?: string | null
          updated_at?: string
          upload_authorization_expires_at?: string | null
          version?: number
        }
        Update: {
          actor_user_id?: string
          authorization_cleanup_claim_id?: string | null
          authorization_cleanup_claimed_at?: string | null
          authorization_issued_at?: string | null
          authorization_retired_at?: string | null
          cleanup_error_code?: string | null
          cleanup_not_before?: string | null
          company_id?: string
          created_at?: string
          declared_mime?: string
          declared_name?: string
          declared_size?: number
          file_object_id?: string | null
          id?: string
          purpose?: Database["public"]["Enums"]["file_purpose"]
          quarantine_object_path?: string
          quota_hold_bytes?: number
          status?: Database["public"]["Enums"]["upload_intent_status"]
          target_resource_id?: string | null
          updated_at?: string
          upload_authorization_expires_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "file_upload_intents_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "file_upload_intents_company_id_file_object_id_fkey"
            columns: ["company_id", "file_object_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "file_upload_intents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
          avatar_file_id: string | null
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
          avatar_file_id?: string | null
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
          avatar_file_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "profiles_avatar_file_id_fkey"
            columns: ["avatar_file_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_items: {
        Row: {
          catalog_item_id: string
          company_id: string
          created_at: string
          description_snapshot: string
          id: string
          item_kind: Database["public"]["Enums"]["catalog_item_kind"]
          line_total: number | null
          monthly_amount: number | null
          months: number | null
          position: number
          proposal_id: string
          quantity: number | null
          segment: string
          unit_amount: number | null
        }
        Insert: {
          catalog_item_id: string
          company_id: string
          created_at?: string
          description_snapshot: string
          id?: string
          item_kind: Database["public"]["Enums"]["catalog_item_kind"]
          line_total?: number | null
          monthly_amount?: number | null
          months?: number | null
          position: number
          proposal_id: string
          quantity?: number | null
          segment: string
          unit_amount?: number | null
        }
        Update: {
          catalog_item_id?: string
          company_id?: string
          created_at?: string
          description_snapshot?: string
          id?: string
          item_kind?: Database["public"]["Enums"]["catalog_item_kind"]
          line_total?: number | null
          monthly_amount?: number | null
          months?: number | null
          position?: number
          proposal_id?: string
          quantity?: number | null
          segment?: string
          unit_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_items_catalog_segment_kind_fk"
            columns: ["company_id", "catalog_item_id", "segment", "item_kind"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["company_id", "id", "segment", "item_kind"]
          },
          {
            foreignKeyName: "proposal_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_items_proposal_segment_fk"
            columns: ["company_id", "proposal_id", "segment"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["company_id", "id", "segment"]
          },
        ]
      }
      proposals: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          created_by: string
          id: string
          issued_on: string
          number: number
          segment: string
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          total: number
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          issued_on: string
          number: number
          segment: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          total?: number
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          issued_on?: string
          number?: number
          segment?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          total?: number
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposals_client_segment_fk"
            columns: ["company_id", "client_id", "segment"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["company_id", "id", "segment"]
          },
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      provisioning_operations: {
        Row: {
          actor_user_id: string
          auth_user_id: string | null
          company_id: string | null
          correlation_id: string
          created_at: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["provisioning_kind"]
          last_error_code: string | null
          request_hash: string
          status: Database["public"]["Enums"]["provisioning_status"]
          subject_email_hash: string
          updated_at: string
        }
        Insert: {
          actor_user_id: string
          auth_user_id?: string | null
          company_id?: string | null
          correlation_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["provisioning_kind"]
          last_error_code?: string | null
          request_hash: string
          status?: Database["public"]["Enums"]["provisioning_status"]
          subject_email_hash: string
          updated_at?: string
        }
        Update: {
          actor_user_id?: string
          auth_user_id?: string | null
          company_id?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["provisioning_kind"]
          last_error_code?: string | null
          request_hash?: string
          status?: Database["public"]["Enums"]["provisioning_status"]
          subject_email_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_operations_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "provisioning_operations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
      company_bank_account_summaries: {
        Row: {
          account_type: Database["public"]["Enums"]["bank_account_type"] | null
          bank_code: string | null
          bank_name: string | null
          company_id: string | null
          created_at: string | null
          holder_name: string | null
          id: string | null
          is_default: boolean | null
          masked_account: string | null
          masked_branch: string | null
          masked_holder_document: string | null
          status: Database["public"]["Enums"]["bank_account_status"] | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          bank_code?: string | null
          bank_name?: string | null
          company_id?: string | null
          created_at?: string | null
          holder_name?: string | null
          id?: string | null
          is_default?: boolean | null
          masked_account?: never
          masked_branch?: never
          masked_holder_document?: never
          status?: Database["public"]["Enums"]["bank_account_status"] | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          bank_code?: string | null
          bank_name?: string | null
          company_id?: string | null
          created_at?: string | null
          holder_name?: string | null
          id?: string | null
          is_default?: boolean | null
          masked_account?: never
          masked_branch?: never
          masked_holder_document?: never
          status?: Database["public"]["Enums"]["bank_account_status"] | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings_safe: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_postal_code: string | null
          address_state: string | null
          address_street: string | null
          company_id: string | null
          consolidated_address: string | null
          letterhead_file_id: string | null
          masked_representative_document: string | null
          representative_name: string | null
          representative_role: string | null
          signature_file_id: string | null
          tax_rate: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          address_street?: string | null
          company_id?: string | null
          consolidated_address?: string | null
          letterhead_file_id?: string | null
          masked_representative_document?: never
          representative_name?: string | null
          representative_role?: string | null
          signature_file_id?: string | null
          tax_rate?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          address_street?: string | null
          company_id?: string | null
          consolidated_address?: string | null
          letterhead_file_id?: string | null
          masked_representative_document?: never
          representative_name?: string | null
          representative_role?: string | null
          signature_file_id?: string | null
          tax_rate?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_company_id_letterhead_file_id_fkey"
            columns: ["company_id", "letterhead_file_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "company_settings_company_id_signature_file_id_fkey"
            columns: ["company_id", "signature_file_id"]
            isOneToOne: false
            referencedRelation: "file_objects"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
    }
    Functions: {
      company_commit_member_provisioning: {
        Args: {
          p_auth_user_id: string
          p_correlation_id: string
          p_display_name: string
          p_email: string
          p_modules: Database["public"]["Enums"]["module_key"][]
          p_operation_id: string
          p_role: Database["public"]["Enums"]["membership_role"]
        }
        Returns: Json
      }
      company_get_api_access_context: { Args: never; Returns: Json }
      company_reserve_member_provisioning: {
        Args: {
          p_correlation_id: string
          p_idempotency_key: string
          p_request_hash: string
          p_subject_email_hash: string
        }
        Returns: Json
      }
      company_update_membership: {
        Args: {
          p_correlation_id: string
          p_display_name: string
          p_expected_version: number
          p_membership_id: string
          p_modules: Database["public"]["Enums"]["module_key"][]
          p_reason: string
          p_role: Database["public"]["Enums"]["membership_role"]
          p_status: Database["public"]["Enums"]["membership_status"]
        }
        Returns: Json
      }
      issue_password_recovery_grant: {
        Args: { p_grant_hash: string }
        Returns: string
      }
    }
    Enums: {
      audit_outcome: "success" | "denied" | "failure"
      audit_scope: "platform" | "tenant"
      bank_account_status: "active" | "archived"
      bank_account_type: "checking" | "savings" | "payment"
      catalog_item_kind: "service" | "product"
      company_status: "active" | "archived"
      file_purpose:
        | "profile_avatar"
        | "company_letterhead"
        | "company_signature"
        | "contract_attachment"
        | "payment_invoice"
        | "certificate"
        | "generated_document"
      file_scan_status: "pending" | "clean" | "infected" | "failed"
      file_status: "ready" | "rejected" | "archived"
      idempotency_state: "processing" | "completed" | "failed"
      membership_role: "company_admin" | "member"
      membership_status: "active" | "suspended"
      module_key: "administrative" | "financial" | "certificates"
      platform_role: "super_admin"
      proposal_status: "draft" | "sent" | "approved" | "rejected"
      provisioning_kind: "company_first_admin" | "company_member"
      provisioning_status:
        | "reserved"
        | "auth_created"
        | "committed"
        | "compensated"
        | "compensation_required"
        | "failed"
      theme_preference: "dark" | "light"
      upload_intent_status:
        | "reserved"
        | "issued"
        | "finalizing"
        | "ready"
        | "rejected"
        | "expired"
        | "cancelled"
        | "cleanup_required"
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
      bank_account_status: ["active", "archived"],
      bank_account_type: ["checking", "savings", "payment"],
      catalog_item_kind: ["service", "product"],
      company_status: ["active", "archived"],
      file_purpose: [
        "profile_avatar",
        "company_letterhead",
        "company_signature",
        "contract_attachment",
        "payment_invoice",
        "certificate",
        "generated_document",
      ],
      file_scan_status: ["pending", "clean", "infected", "failed"],
      file_status: ["ready", "rejected", "archived"],
      idempotency_state: ["processing", "completed", "failed"],
      membership_role: ["company_admin", "member"],
      membership_status: ["active", "suspended"],
      module_key: ["administrative", "financial", "certificates"],
      platform_role: ["super_admin"],
      proposal_status: ["draft", "sent", "approved", "rejected"],
      provisioning_kind: ["company_first_admin", "company_member"],
      provisioning_status: [
        "reserved",
        "auth_created",
        "committed",
        "compensated",
        "compensation_required",
        "failed",
      ],
      theme_preference: ["dark", "light"],
      upload_intent_status: [
        "reserved",
        "issued",
        "finalizing",
        "ready",
        "rejected",
        "expired",
        "cancelled",
        "cleanup_required",
      ],
    },
  },
} as const
