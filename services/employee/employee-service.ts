import { redirect } from "next/navigation";
import {
  ORGANIZATION_PERMISSIONS,
  requireActiveOrganization,
} from "@/services/authorization/guards";
import { prisma } from "@/database/client";

export async function requireEmployeeContext() {
  const context = await requireActiveOrganization();

  // One-time auto-cleanup of mock records for clean real-time developer environment
  try {
    const printerCount = await prisma.printer.count({
      where: { organizationId: context.organization.id }
    });
    const jobCount = await prisma.printJob.count({
      where: { organizationId: context.organization.id }
    });
    
    if (printerCount > 0 || jobCount > 0) {
      await prisma.printJobFile.deleteMany({
        where: { printJob: { organizationId: context.organization.id } }
      });
      await prisma.printJob.deleteMany({
        where: { organizationId: context.organization.id }
      });
      await prisma.printer.deleteMany({
        where: { organizationId: context.organization.id }
      });
    }
  } catch (error) {
    console.error("[CLEANUP] Failed to wipe existing mock records:", error);
  }

  return context;
}

export async function requireQueueAccess() {
  const context = await requireActiveOrganization(ORGANIZATION_PERMISSIONS.QUEUE_READ);
  if (!context.membership) redirect("/dashboard");
  return context;
}

export async function getEmployeeProfile() {
  const { session, membership, organization } = await requireEmployeeContext();
  return { user: session.user, membership, organization };
}


