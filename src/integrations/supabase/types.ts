export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      approved_users: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email: string
          id?: string
          name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      estimates: {
        Row: {
          area: number
          category: string
          created_at: string
          description: string
          discipline: string
          height: number
          id: string
          length: number
          package: string
          project_id: string
          quantity: number
          thickness: number
          trade: string
          unit: string
          unit_cost: number
          unit_qty: number
          uom: string
          updated_at: string
          user_id: string
          width: number
        }
        Insert: {
          area?: number
          category?: string
          created_at?: string
          description?: string
          discipline?: string
          height?: number
          id?: string
          length?: number
          package?: string
          project_id: string
          quantity?: number
          thickness?: number
          trade?: string
          unit?: string
          unit_cost?: number
          unit_qty?: number
          uom?: string
          updated_at?: string
          user_id: string
          width?: number
        }
        Update: {
          area?: number
          category?: string
          created_at?: string
          description?: string
          discipline?: string
          height?: number
          id?: string
          length?: number
          package?: string
          project_id?: string
          quantity?: number
          thickness?: number
          trade?: string
          unit?: string
          unit_cost?: number
          unit_qty?: number
          uom?: string
          updated_at?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      global_shifts: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          name: string
          shift_id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          name: string
          shift_id: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          name?: string
          shift_id?: string
          start_time?: string
        }
        Relationships: []
      }
      project_cost_proposals: {
        Row: {
          package: string
          project_id: string
          proposal: Json
          updated_at: string
        }
        Insert: {
          package?: string
          project_id: string
          proposal?: Json
          updated_at?: string
        }
        Update: {
          package?: string
          project_id?: string
          proposal?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cost_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cost_rates: {
        Row: {
          created_at: string
          id: string
          key: string
          kind: string
          label: string
          project_id: string
          rate: number
          rate_unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          kind?: string
          label?: string
          project_id: string
          rate?: number
          rate_unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          kind?: string
          label?: string
          project_id?: string
          rate?: number
          rate_unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cost_rates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cost_settings: {
        Row: {
          created_at: string
          currency: string
          hours_per_day: number
          id: string
          overhead_pct: number
          profit_pct: number
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          hours_per_day?: number
          id?: string
          overhead_pct?: number
          profit_pct?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          hours_per_day?: number
          id?: string
          overhead_pct?: number
          profit_pct?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cost_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_fuel_plans: {
        Row: { project_id: string; plan: Json; revision: number }
        Insert: { project_id: string; plan: Json; revision?: number }
        Update: { plan?: Json; revision?: number }
        Relationships: [
          {
            foreignKeyName: "project_fuel_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string | null
          project_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name?: string | null
          project_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_holidays_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_shifts: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          is_active: boolean | null
          project_id: string
          shift_id: string
          shift_name: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          is_active?: boolean | null
          project_id: string
          shift_id: string
          shift_name: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          is_active?: boolean | null
          project_id?: string
          shift_id?: string
          shift_name?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_shifts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_specs: {
        Row: {
          created_at: string
          extracted_text: string
          file_name: string
          file_path: string
          file_type: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string
          file_name: string
          file_path: string
          file_type?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_text?: string
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_specs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_demo: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rotation_schedule: {
        Row: {
          created_at: string | null
          date: string
          end_time: string
          id: string
          locked: boolean | null
          planned_hours: number
          project_id: string
          rotation_status: string
          shift_id: string
          shift_name: string
          start_time: string
          trade: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time: string
          id?: string
          locked?: boolean | null
          planned_hours: number
          project_id: string
          rotation_status: string
          shift_id: string
          shift_name: string
          start_time: string
          trade: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string
          id?: string
          locked?: boolean | null
          planned_hours?: number
          project_id?: string
          rotation_status?: string
          shift_id?: string
          shift_name?: string
          start_time?: string
          trade?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rotation_schedule_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_settings: {
        Row: {
          created_at: string | null
          default_shift_length_hours: number
          end_date: string
          id: string
          project_id: string
          rotation_pattern: string
          rotation_type: string
          start_date: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_shift_length_hours?: number
          end_date: string
          id?: string
          project_id: string
          rotation_pattern: string
          rotation_type?: string
          start_date: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_shift_length_hours?: number
          end_date?: string
          id?: string
          project_id?: string
          rotation_pattern?: string
          rotation_type?: string
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rotation_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          created_at: string
          duration: number
          equipment: string
          id: string
          manpower: number
          name: string
          notes: string | null
          parent_id: string | null
          predecessor_ids: string[]
          project_id: string | null
          start_date: string
          trade: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration: number
          equipment: string
          id?: string
          manpower: number
          name: string
          notes?: string | null
          parent_id?: string | null
          predecessor_ids?: string[]
          project_id?: string | null
          start_date: string
          trade: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration?: number
          equipment?: string
          id?: string
          manpower?: number
          name?: string
          notes?: string | null
          parent_id?: string | null
          predecessor_ids?: string[]
          project_id?: string | null
          start_date?: string
          trade?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      am_i_approved: { Args: never; Returns: boolean }
      apply_schedule_dates: {
        Args: { _project_id: string; _updates: Json }
        Returns: undefined
      }
      is_email_approved: { Args: { _email: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "user"],
    },
  },
} as const
