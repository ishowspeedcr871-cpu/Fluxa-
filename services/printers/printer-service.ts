"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/database/client";
import { createPrinterSchema } from "@/features/print-queue/schemas";
import {
  ORGANIZATION_PERMISSIONS,
  requireOrganizationPermission,
} from "@/services/authorization/guards";
import { createAuditLog } from "@/services/audit/log";

export async function listPrinters() {
  try {
    const { organization } = await requireOrganizationPermission(
      ORGANIZATION_PERMISSIONS.PRINTERS_READ,
    );

    // Timeout logic simulated by abort controller on prisma isn't straightforward natively for findMany, 
    // but Prisma queries are usually fast. We'll wrap in standard try/catch.
    const printers = await prisma.printer.findMany({
      where: { organizationId: organization.id, deletedAt: null },
      include: { 
        _count: { select: { jobs: { where: { status: { in: ["QUEUED", "PRINTING"] } } } } } 
      },
      orderBy: [{ status: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    });
    
    return printers || [];
  } catch (error) {
    console.error("Error fetching printers:", error);
    return [];
  }
}

export async function getPrinterDetails(id: string) {
  const { organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_READ,
  );
  return prisma.printer.findFirst({
    where: { id, organizationId: organization.id, deletedAt: null },
    include: {
      jobs: {
        where: { status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        take: 10
      }
    }
  });
}

export async function updatePrinterTelemetry(id: string, data: any) {
  const { organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_WRITE,
  );
  return prisma.printer.update({
    where: { id, organizationId: organization.id },
    data: {
      ...data,
      lastSeenAt: new Date(),
    }
  });
}

export async function upsertPrinterFromDiscovery(organizationId: string, printerData: any) {
  // This would be called by the Desktop Connector API
  const { macAddress, ipAddress, name } = printerData;
  
  return prisma.printer.upsert({
    where: { 
      // In a real app we'd likely use a unique identifier like serial number or MAC
      // For now we'll match by name + organization as a fallback
      id: printerData.id || "new-printer",
    },
    update: {
      ...printerData,
      lastSeenAt: new Date(),
      status: "ONLINE",
    },
    create: {
      organizationId,
      ...printerData,
      status: "ONLINE",
      lastSeenAt: new Date(),
    }
  });
}

export async function getPrinterDashboard() {
  const { organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_READ,
  );
  const [online, busy, offline, warnings] = await prisma.$transaction([
    prisma.printer.count({
      where: { organizationId: organization.id, status: "ONLINE", deletedAt: null },
    }),
    prisma.printer.count({
      where: { organizationId: organization.id, status: "BUSY", deletedAt: null },
    }),
    prisma.printer.count({
      where: { organizationId: organization.id, status: "OFFLINE", deletedAt: null },
    }),
    prisma.printer.count({
      where: { organizationId: organization.id, health: { not: "GOOD" }, deletedAt: null },
    }),
  ]);
  return { online, busy, offline, warnings };
}

export async function createPrinterAction(formData: FormData) {
  const parsed = createPrinterSchema.safeParse({
    name: formData.get("name"),
    location: formData.get("location"),
    model: formData.get("model"),
    isColor: formData.get("isColor") === "on",
    supportsDuplex: formData.get("supportsDuplex") === "on",
  });
  if (!parsed.success) redirect("/employee/printers?error=invalid_printer");
  const { session, organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_WRITE,
  );
  const printer = await prisma.printer.create({
    data: {
      organizationId: organization.id,
      ...parsed.data,
      location: parsed.data.location || null,
      model: parsed.data.model || null,
    },
  });
  await createAuditLog({
    organizationId: organization.id,
    actorUserId: session.userId,
    action: "printer.created",
    entityType: "Printer",
    entityId: printer.id,
  });
  redirect("/employee/printers?created=1");
}

export async function registerPrinterAction(formData: FormData) {
  const parsed = createPrinterSchema.safeParse({
    name: formData.get("name"),
    location: formData.get("location"),
    model: formData.get("model"),
    isColor: formData.get("isColor") === "on",
    supportsDuplex: formData.get("supportsDuplex") === "on",
  });
  if (!parsed.success) redirect("/printers?error=invalid_printer");
  const { session, organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_WRITE,
  );
  const printer = await prisma.printer.create({
    data: {
      organizationId: organization.id,
      ...parsed.data,
      location: parsed.data.location || null,
      model: parsed.data.model || null,
    },
  });
  await createAuditLog({
    organizationId: organization.id,
    actorUserId: session.userId,
    action: "printer.created",
    entityType: "Printer",
    entityId: printer.id,
  });
  redirect("/printers?created=1");
}

export async function sendCommandToPrinter(printerId: string, jobId: string) {
  const { organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.PRINTERS_WRITE,
  );
  
  // Update printer and job status to PRINTING
  await prisma.$transaction([
    prisma.printer.update({
      where: { id: printerId, organizationId: organization.id },
      data: { status: "BUSY" }
    }),
    prisma.printJob.update({
      where: { id: jobId, organizationId: organization.id },
      data: { 
        status: "PRINTING",
        printerId: printerId,
        processingStartedAt: new Date(),
        events: {
          create: {
            toStatus: "PRINTING",
            note: "Hardware command received from OTP release."
          }
        }
      }
    })
  ]);

  // In a real system, the printer would callback when done.
  // For the portal experience, we'll auto-complete it after a moment or just return.
}
