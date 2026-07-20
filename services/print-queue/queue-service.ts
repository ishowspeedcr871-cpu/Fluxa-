import { prisma } from "@/database/client";
import type { QueueQuery } from "@/features/print-queue/schemas";
import { queueQuerySchema } from "@/features/print-queue/schemas";
import { requireQueueAccess } from "@/services/employee/employee-service";

export async function getEmployeeDashboard() {
  const { session, organization } = await requireQueueAccess();
  const [queued, assignedToMe, printing, ready, urgent] = await prisma.$transaction([
    prisma.printJob.count({ where: { organizationId: organization.id, status: "QUEUED" } }),
    prisma.printJob.count({
      where: {
        organizationId: organization.id,
        assignedUserId: session.userId,
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
      },
    }),
    prisma.printJob.count({ where: { organizationId: organization.id, status: "PRINTING" } }),
    prisma.printJob.count({ where: { organizationId: organization.id, status: "READY" } }),
    prisma.printJob.count({
      where: {
        organizationId: organization.id,
        priority: "URGENT",
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
      },
    }),
  ]);
  return { queued, assignedToMe, printing, ready, urgent };
}

export async function listPrintQueue(input: QueueQuery) {
  try {
    const { session, organization } = await requireQueueAccess();
    const query = queueQuerySchema.parse(input);
    const skip = (query.page - 1) * query.pageSize;
    const where = {
      organizationId: organization.id,
      ...(query.status === "all" ? {} : { status: query.status }),
      ...(query.priority === "all" ? {} : { priority: query.priority }),
      ...(query.assigned === "mine"
        ? { assignedUserId: session.userId }
        : query.assigned === "unassigned"
          ? { assignedUserId: null }
          : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" as const } },
              { customerUser: { email: { contains: query.q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const orderBy =
      query.sort === "title"
        ? { title: query.direction }
        : query.sort === "status"
          ? { status: query.direction }
          : query.sort === "priority"
            ? { priority: query.direction }
            : { createdAt: query.direction };
    const [jobs, total] = await prisma.$transaction([
      prisma.printJob.findMany({
        where,
        include: { customerUser: true, assignedUser: true, printer: true, files: true },
        orderBy,
        skip,
        take: query.pageSize,
      }),
      prisma.printJob.count({ where }),
    ]);
    return {
      jobs,
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  } catch (error) {
    console.error("Error in listPrintQueue:", error);
    return {
      jobs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    };
  }
}

export async function listAssignedJobs() {
  const { session, organization } = await requireQueueAccess();
  return prisma.printJob.findMany({
    where: {
      organizationId: organization.id,
      assignedUserId: session.userId,
      status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
    },
    include: { customerUser: true, printer: true, files: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
}

export async function getQueueJob(jobId: string) {
  const { organization } = await requireQueueAccess();
  return prisma.printJob.findFirst({
    where: { id: jobId, organizationId: organization.id },
    include: {
      customerUser: true,
      assignedUser: true,
      printer: true,
      files: true,
      otpHistory: {
        include: { generatedByUser: true, verifiedByUser: true },
        orderBy: { createdAt: "desc" },
      },
      events: { include: { actorUser: true }, orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function searchCustomers(q?: string) {
  const { organization } = await requireQueueAccess();
  return prisma.user.findMany({
    where: {
      memberships: { some: { organizationId: organization.id, status: "ACTIVE" } },
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      memberships: { where: { organizationId: organization.id }, include: { role: true } },
      _count: { select: { customerPrintJobs: true } },
    },
    orderBy: { email: "asc" },
    take: 25,
  });
}

export async function releasePrintJobByOtp(otp: string) {
  const { session, organization } = await requireQueueAccess();
  // Find OTP
  const foundOtp = await prisma.printJobOtp.findFirst({
    where: {
      code: otp,
      status: "ACTIVE",
      printJob: { organizationId: organization.id }
    },
    include: { printJob: true }
  });

  if (!foundOtp) {
    throw new Error("Invalid or expired OTP");
  }

  // Verify it
  await prisma.printJobOtp.update({
    where: { id: foundOtp.id },
    data: { 
      status: "VERIFIED", 
      verifiedAt: new Date(),
      verifiedByUserId: session.userId 
    }
  });

  // Update PrintJob
  const job = await prisma.printJob.update({
    where: { id: foundOtp.printJobId },
    data: { status: "COMPLETED" }
  });

  return job;
}
