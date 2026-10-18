import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// Who is using the app. A team member (secretary) works in the owner's data;
// the database enforces that through public.current_owner_id().

export type TeamRole = "owner" | "secretary";

export type TeamContext = {
  role: TeamRole;
  userId: string;
  /** The account whose data is shown: the owner's id for a team member. */
  ownerId: string;
  displayName: string | null;
};

/** Menu items and pages only the owner sees. */
export const OWNER_ONLY_SECTIONS = new Set(["accounting", "holo-sync", "campaigns", "team"]);

export const getTeamContext = cache(async (): Promise<TeamContext | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("team_members")
    .select("owner_id,role,display_name")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  // No row (or no table before migration 028): the user is an owner.
  if (!data) return { role: "owner", userId: auth.user.id, ownerId: auth.user.id, displayName: null };
  return {
    role: data.role as TeamRole,
    userId: auth.user.id,
    ownerId: data.owner_id as string,
    displayName: data.display_name as string,
  };
});

export async function isOwner() {
  return (await getTeamContext())?.role === "owner";
}
