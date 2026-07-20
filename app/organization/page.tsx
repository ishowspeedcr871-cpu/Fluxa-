import { redirect } from "next/navigation";
import { OrganizationPortalLayout } from "@/layouts/organization-portal-layout";
import { requireOrganizationOrRedirect } from "@/services/organizations/actions";
import { getActiveOrganizationMembership } from "@/services/organizations/organization-service";
import { OrganizationDashboardClient } from "@/components/organization/organization-dashboard-client";
import { listPrinters } from "@/services/printers/printer-service";
import { getCurrentSession } from "@/services/auth/session";

export default async function OrganizationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireOrganizationOrRedirect();
  const membership = await getActiveOrganizationMembership();
  const session = await getCurrentSession();

  if (!membership) redirect("/onboarding/organization");

  const organization = membership.organization;
  const printers = await listPrinters();
  const params = await searchParams;
  
  const success = params.success === "printing" 
    ? `Command sent to ${params.printer}.` 
    : params.success === "verified" 
    ? "OTP Verified. No online printer found."
    : params.success === "printed"
    ? "Job successfully sent to printer."
    : undefined;

  return (
    <OrganizationPortalLayout 
      organizationName={organization.name}
      userEmail={session?.user?.email || undefined}
    >
      <OrganizationDashboardClient 
        organizationName={organization.name}
        connectedPrinters={printers.map(p => ({
          id: p.id,
          name: p.name,
          status: p.status,
          brand: p.brand,
          connectionType: p.connectionType,
          inkLevel: p.inkLevel
        }))}
        successMessage={success}
      />
    </OrganizationPortalLayout>
  );
}
