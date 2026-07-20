import { notFound } from "next/navigation";
import { getCurrentSession } from "@/services/auth/session";
import { AuthorizationError } from "@/services/auth/errors";

export function isPlatformSession(session: Awaited<ReturnType<typeof getCurrentSession>>) {
  return Boolean(
    session?.user.memberships.some(
      (membership) =>
        membership.status === "ACTIVE" &&
        membership.role.scope === "PLATFORM" &&
        membership.organization.status === "ACTIVE" &&
        membership.organization.deletedAt === null,
    ),
  );
}

export async function requireMasterDeveloper(options?: { api?: boolean }) {
  const session = await getCurrentSession();
  if (!isPlatformSession(session)) {
    if (options?.api) throw new AuthorizationError();
    notFound();
  }
  return session!;
}
