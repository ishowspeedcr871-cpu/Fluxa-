import { redirect } from "next/navigation";
import { getMasterDeveloperSession } from "@/services/developer/master-auth";

export async function requireMasterDeveloper() {
  const session = await getMasterDeveloperSession();
  if (!session) redirect("/developer/login");
  return session;
}
