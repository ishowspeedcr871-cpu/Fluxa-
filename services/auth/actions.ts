"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/database/client";
import { createAuditLog } from "@/services/audit/log";
import { verifyPassword } from "@/services/auth/password";
import { createUserSession, signOutCurrentSession } from "@/services/auth/session";

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8),
});

async function authenticate(formData: FormData, redirectTo: string, errorPath: string) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) redirect(`${errorPath}?error=invalid_input`);

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: {
        memberships: {
          include: {
            role: true,
          },
        },
      },
    });
  } catch (error) {
    console.error("Authentication lookup failed", error);
    redirect(`${errorPath}?error=service_unavailable`);
  }

  if (!user?.passwordHash) {
    redirect(`${errorPath}?error=invalid_credentials`);
  }

  const isValid = verifyPassword(parsed.data.password, user.passwordHash);
  if (!isValid) {
    redirect(`${errorPath}?error=invalid_credentials`);
  }

  // Check if the user is suspended or soft-deleted
  if (user && (user.status === "SUSPENDED" || user.deletedAt !== null)) {
    redirect(`${errorPath}?error=user_suspended`);
  }

  // Check if the user's organization(s) are suspended or soft-deleted
  if (user && user.memberships && user.memberships.length > 0) {
    const activeMemberships = user.memberships.filter((m: any) => {
      return (
        m.organization && m.organization.status === "ACTIVE" && m.organization.deletedAt === null
      );
    });

    if (activeMemberships.length === 0) {
      redirect(`${errorPath}?error=org_suspended`);
    }
  }

  const portal = formData.get("portal") as string | null;
  const isEmployeeLogin = portal === "employee";
  const portalRole = isEmployeeLogin ? "ORGANIZATION" : "CUSTOMER";

  let targetRedirect = redirectTo;

  if (isEmployeeLogin) {
    targetRedirect = "/employee";
  } else if (user && user.memberships && user.memberships.length > 0) {
    const isCustomer = user.memberships.some((m: any) => m.role.scope === "CUSTOMER");
    const isEmployee = user.memberships.some((m: any) => m.role.scope === "ORGANIZATION");

    if (redirectTo === "/dashboard" || redirectTo === "/") {
      if (isCustomer) {
        targetRedirect = "/customer";
      } else if (isEmployee) {
        targetRedirect = "/employee";
      }
    }
  }

  await createUserSession(user.id, portalRole);
  await createAuditLog({ actorUserId: user.id, action: "auth.login_succeeded" });
  redirect(targetRedirect);
}

export async function loginAction(next: string, formData: FormData) {
  const safeNext = next?.startsWith("/") ? next : "/dashboard";
  return authenticate(formData, safeNext, "/login");
}

export async function logoutAction() {
  await signOutCurrentSession();
  redirect("/login?portal=customer");
}
