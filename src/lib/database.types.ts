export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      campaign_members: {
        Row: {
          campaign_id: string;
          joined_at: string;
          role: Database["public"]["Enums"]["campaign_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          campaign_id: string;
          joined_at?: string;
          role: Database["public"]["Enums"]["campaign_role"];
          user_id: string;
        };
        Update: {
          campaign_id?: string;
          joined_at?: string;
          role?: Database["public"]["Enums"]["campaign_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_members_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_members_profile_fk";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          created_at: string;
          created_by: string;
          description: string;
          id: string;
          name: string;
          settings: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string;
          id?: string;
          name: string;
          settings?: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string;
          id?: string;
          name?: string;
          settings?: NonNullable<Json>;
        };
        Relationships: [];
      };
      characters: {
        Row: {
          campaign_id: string;
          class_summary: string;
          created_at: string;
          id: string;
          level: number;
          name: string;
          notes: string;
          owner_id: string;
          photo_path: string | null;
          race: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["character_visibility"];
        };
        ComputedFields: never;
        Insert: {
          campaign_id: string;
          class_summary?: string;
          created_at?: string;
          id?: string;
          level?: number;
          name: string;
          notes?: string;
          owner_id: string;
          photo_path?: string | null;
          race?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["character_visibility"];
        };
        Update: {
          campaign_id?: string;
          class_summary?: string;
          created_at?: string;
          id?: string;
          level?: number;
          name?: string;
          notes?: string;
          owner_id?: string;
          photo_path?: string | null;
          race?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["character_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "characters_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      dm_notes: {
        Row: {
          author_id: string;
          body: string;
          campaign_id: string;
          character_id: string | null;
          created_at: string;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body?: string;
          campaign_id: string;
          character_id?: string | null;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          campaign_id?: string;
          character_id?: string | null;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dm_notes_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_notes_character_id_campaign_id_fkey";
            columns: ["character_id", "campaign_id"];
            isOneToOne: false;
            referencedRelation: "character_public";
            referencedColumns: ["id", "campaign_id"];
          },
          {
            foreignKeyName: "dm_notes_character_id_campaign_id_fkey";
            columns: ["character_id", "campaign_id"];
            isOneToOne: false;
            referencedRelation: "characters";
            referencedColumns: ["id", "campaign_id"];
          },
        ];
      };
      invites: {
        Row: {
          campaign_id: string;
          code: string;
          created_at: string;
          created_by: string;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          revoked: boolean;
          uses: number;
        };
        ComputedFields: never;
        Insert: {
          campaign_id: string;
          code: string;
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          revoked?: boolean;
          uses?: number;
        };
        Update: {
          campaign_id?: string;
          code?: string;
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          revoked?: boolean;
          uses?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invites_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name: string;
          id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      character_public: {
        Row: {
          campaign_id: string | null;
          class_summary: string | null;
          id: string | null;
          level: number | null;
          name: string | null;
          owner_id: string | null;
          photo_path: string | null;
          race: string | null;
        };
        ComputedFields: never;
        Insert: {
          campaign_id?: string | null;
          class_summary?: string | null;
          id?: string | null;
          level?: number | null;
          name?: string | null;
          owner_id?: string | null;
          photo_path?: string | null;
          race?: string | null;
        };
        Update: {
          campaign_id?: string | null;
          class_summary?: string | null;
          id?: string | null;
          level?: number | null;
          name?: string | null;
          owner_id?: string | null;
          photo_path?: string | null;
          race?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "characters_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      accept_invite: { Args: { p_code: string }; Returns: string };
      create_campaign: { Args: { p_description?: string; p_name: string }; Returns: string };
      create_invite: {
        Args: { p_campaign_id: string; p_expires_in_days?: number; p_max_uses?: number };
        Returns: {
          campaign_id: string;
          code: string;
          created_at: string;
          created_by: string;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          revoked: boolean;
          uses: number;
        };
        SetofOptions: {
          from: "*";
          to: "invites";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      generate_invite_code: { Args: Record<PropertyKey, never>; Returns: string };
      is_campaign_dm: { Args: { p_campaign_id: string }; Returns: boolean };
      is_campaign_member: { Args: { p_campaign_id: string }; Returns: boolean };
      is_user_in_campaign: { Args: { p_campaign_id: string; p_user_id: string }; Returns: boolean };
      preview_invite: {
        Args: { p_code: string };
        Returns: {
          already_member: boolean;
          campaign_id: string;
          campaign_name: string;
          dm_name: string;
        }[];
      };
      shares_campaign_with: { Args: { p_user_id: string }; Returns: boolean };
    };
    Enums: {
      campaign_role: "dm" | "player";
      character_visibility: "public_only" | "full";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      campaign_role: ["dm", "player"],
      character_visibility: ["public_only", "full"],
    },
  },
} as const;
