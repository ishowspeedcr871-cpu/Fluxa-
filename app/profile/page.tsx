import { redirect } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PortalLayout } from "@/layouts/portal-layout";
import { getCurrentSession } from "@/services/auth/session";
import { getActiveOrganizationMembership } from "@/services/organizations/organization-service";

export default async function ProfilePage() {
  const session = await getCurrentSession();

  if (!session) redirect("/login");

  const membership = await getActiveOrganizationMembership();

  return (
    <PortalLayout>
      <Card>
        <CardHeader>
          <Avatar name={session.user.name ?? session.user.email} />
          <CardTitle>{session.user.name ?? "FLUXA User"}</CardTitle>
          <CardDescription>{session.user.email}</CardDescription>
          {membership ? (
            <div className="pt-4">
              <StatusBadge
                status="online"
                label={`${membership.organization.name} · ${membership.role.name}`}
              />
            </div>
          ) : null}
        </CardHeader>
      </Card>
    </PortalLayout>
  );
}
