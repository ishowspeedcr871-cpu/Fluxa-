"use server";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/database/client";
import { createAuditLog } from "@/services/audit/log";
import {
  ORGANIZATION_PERMISSIONS,
  requireOrganizationPermission,
} from "@/services/authorization/guards";
import { createNotification } from "@/services/notifications/notification-service";
import { requireCustomerContext } from "@/services/customer/customer-service";
import { sendCommandToPrinter } from "@/services/printers/printer-service";

const OTP_TTL_MINUTES = 15;
const OTP_DIGITS = 6;

function getOtpSecret() {
  return process.env.AUTH_SECRET ?? "development-auth-secret";
}

function normalizeOtp(code: string) {
  return code.replace(/\D/g, "").slice(0, OTP_DIGITS);
}

function hashOtp(code: string) {
  return createHmac("sha256", getOtpSecret()).update(normalizeOtp(code)).digest("hex");
}

function compareOtp(code: string, codeHash: string) {
  const candidate = Buffer.from(hashOtp(code), "hex");
  const expected = Buffer.from(codeHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function generateOtpCode() {
  return randomInt(0, 10 ** OTP_DIGITS)
    .toString()
    .padStart(OTP_DIGITS, "0");
}

async function expireStaleOtps(printJobId: string) {
  await prisma.printJobOtp.updateMany({
    where: { printJobId, status: "ACTIVE", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

export async function generateCollectionOtp(printJobId: string) {
  const { session, organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.QUEUE_MANAGE,
  );
  const current = await prisma.printJob.findFirst({
    where: { id: printJobId, organizationId: organization.id },
  });
  if (!current) throw new Error("Print job not found.");

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const job = await prisma.$transaction(async (tx) => {
    await tx.printJobOtp.updateMany({
      where: { printJobId: current.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await tx.printJobOtp.create({
      data: {
        printJobId: current.id,
        codeHash: hashOtp(code),
        generatedByUserId: session.userId,
        expiresAt,
      },
    });
    return tx.printJob.update({
      where: { id: current.id },
      data: {
        status: "OTP_GENERATED",
        readyAt: current.readyAt ?? new Date(),
        otpCodeHash: hashOtp(code),
        otpGeneratedAt: new Date(),
        events: {
          create: {
            actorUserId: session.userId,
            fromStatus: current.status,
            toStatus: "OTP_GENERATED",
            note: `Collection OTP generated. Expires at ${expiresAt.toLocaleString()}.`,
          },
        },
        activities: {
          create: {
            organizationId: organization.id,
            userId: current.customerUserId,
            action: "print_job.otp_generated",
            description: "A secure collection OTP was generated for this print job.",
          },
        },
        notifications: {
          create: {
            organizationId: organization.id,
            userId: current.customerUserId,
            title: "Your print job is ready for collection",
            message: `Use collection OTP ${code}. It expires at ${expiresAt.toLocaleString()}.`,
          },
        },
      },
    });
  });

  await createAuditLog({
    organizationId: organization.id,
    actorUserId: session.userId,
    action: "print_job.otp_generated",
    entityType: "PrintJob",
    entityId: job.id,
    metadata: { expiresAt: expiresAt.toISOString() },
  });
  await createNotification({
    organizationId: organization.id,
    userId: current.customerUserId,
    type: "OTP_GENERATED",
    title: "Collection OTP generated",
    message: "Your print job is ready for collection. Check your job notification for the OTP.",
    entityType: "PrintJob",
    entityId: job.id,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  return { job, code, expiresAt };
}

export async function verifyCollectionOtp(printJobId: string, code: string) {
  const { session, organization } = await requireOrganizationPermission(
    ORGANIZATION_PERMISSIONS.QUEUE_MANAGE,
  );
  const current = await prisma.printJob.findFirst({
    where: { id: printJobId, organizationId: organization.id },
    include: { otpHistory: { orderBy: { createdAt: "desc" } } },
  });
  if (!current) throw new Error("Print job not found.");
  await expireStaleOtps(current.id);

  const activeOtp = current.otpHistory.find(
    (otp) => otp.status === "ACTIVE" && otp.expiresAt > new Date(),
  );
  if (!activeOtp || !compareOtp(code, activeOtp.codeHash)) {
    await createAuditLog({
      organizationId: organization.id,
      actorUserId: session.userId,
      action: "print_job.otp_verification_failed",
      entityType: "PrintJob",
      entityId: current.id,
      severity: "WARNING",
    });
    throw new Error("Invalid or expired collection OTP.");
  }

  const now = new Date();
  const job = await prisma.$transaction(async (tx) => {
    await tx.printJobOtp.update({
      where: { id: activeOtp.id },
      data: { status: "VERIFIED", verifiedByUserId: session.userId, verifiedAt: now },
    });
    return tx.printJob.update({
      where: { id: current.id },
      data: {
        status: "COMPLETED",
        collectedAt: now,
        completedAt: now,
        otpCodeHash: null,
        events: {
          create: [
            {
              actorUserId: session.userId,
              fromStatus: current.status,
              toStatus: "COLLECTED",
              note: "Customer collection OTP verified.",
            },
            {
              actorUserId: session.userId,
              fromStatus: "COLLECTED",
              toStatus: "COMPLETED",
              note: "Print job completed after collection.",
            },
          ],
        },
        activities: {
          create: {
            organizationId: organization.id,
            userId: current.customerUserId,
            action: "print_job.collected",
            description: "Collection OTP verified and print job completed.",
          },
        },
        notifications: {
          create: {
            organizationId: organization.id,
            userId: current.customerUserId,
            title: "Print job completed",
            message: "Your print job was collected and marked complete.",
          },
        },
      },
    });
  });

  await createAuditLog({
    organizationId: organization.id,
    actorUserId: session.userId,
    action: "print_job.collected",
    entityType: "PrintJob",
    entityId: job.id,
    metadata: { otpId: activeOtp.id },
  });
  await createNotification({
    organizationId: organization.id,
    userId: current.customerUserId,
    type: "JOB_COLLECTED",
    title: "Print job collected",
    message: "Your print job has been collected and completed.",
    entityType: "PrintJob",
    entityId: job.id,
    metadata: { otpId: activeOtp.id },
  });

  return job;
}

export async function globalVerifyOtpAction(formData: FormData) {
  const code = normalizeOtp(String(formData.get("otp") ?? ""));
  if (code.length !== OTP_DIGITS) redirect("/organization?error=invalid_otp");

  const hashedCode = hashOtp(code);
  const jobOtp = await prisma.printJobOtp.findFirst({
    where: {
      codeHash: hashedCode,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
    include: { printJob: true },
  });

  if (!jobOtp) redirect("/organization?error=otp_not_found");

  // 1. Verify the OTP
  await verifyCollectionOtp(jobOtp.printJobId, code);
  
  // 2. Automatically find an online printer to fulfill the request
  const printer = await prisma.printer.findFirst({
    where: { 
      organizationId: jobOtp.printJob.organizationId, 
      status: "ONLINE", 
      deletedAt: null 
    }
  });

  if (printer) {
    // 3. Send the hardware command
    await sendCommandToPrinter(printer.id, jobOtp.printJobId);
    redirect(`/organization?success=printing&job=${jobOtp.printJobId}&printer=${printer.name}`);
  } else {
    // If no printer is online, it's still verified but we warn the employee
    redirect(`/organization?success=verified&job=${jobOtp.printJobId}&warning=no_online_printer`);
  }
}

export async function generateCollectionOtpAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) redirect("/employee/queue?error=invalid_job");
  await generateCollectionOtp(jobId);
  redirect(`/employee/queue/${jobId}?otp=generated`);
}

export async function generateCustomerReleaseOtp(printJobId: string) {
  const { session, organization } = await requireCustomerContext();
  const current = await prisma.printJob.findFirst({
    where: { id: printJobId, organizationId: organization.id, customerUserId: session.userId },
  });
  if (!current) throw new Error("Print job not found.");

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const job = await prisma.$transaction(async (tx) => {
    await tx.printJobOtp.updateMany({
      where: { printJobId: current.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await tx.printJobOtp.create({
      data: {
        printJobId: current.id,
        codeHash: hashOtp(code),
        generatedByUserId: session.userId,
        expiresAt,
      },
    });
    return tx.printJob.update({
      where: { id: current.id },
      data: {
        status: "OTP_GENERATED",
        otpCodeHash: hashOtp(code),
        otpGeneratedAt: new Date(),
        events: {
          create: {
            actorUserId: session.userId,
            fromStatus: current.status,
            toStatus: "OTP_GENERATED",
            note: `Secure release OTP generated by customer. Expires at ${expiresAt.toLocaleString()}.`,
          },
        },
        activities: {
          create: {
            organizationId: organization.id,
            userId: session.userId,
            action: "print_job.otp_generated",
            description: `Generated secure print release OTP: ${code}`,
          },
        },
        notifications: {
          create: {
            organizationId: organization.id,
            userId: session.userId,
            title: "Your print release OTP is ready",
            message: `Use collection OTP ${code}. It expires at ${expiresAt.toLocaleString()}.`,
          },
        },
      },
    });
  });

  return { job, code, expiresAt };
}

export async function generateCustomerReleaseOtpAction(formData: FormData) {
  "use server";
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) redirect("/customer?error=invalid_job");
  try {
    const { code } = await generateCustomerReleaseOtp(jobId);
    redirect(`/customer/jobs/${jobId}?otp_code=${code}`);
  } catch (err) {
    redirect(`/customer/jobs/${jobId}?error=otp_failed`);
  }
}

export async function verifyCollectionOtpAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const code = normalizeOtp(String(formData.get("otp") ?? ""));
  if (!jobId || code.length !== OTP_DIGITS)
    redirect(`/employee/queue/${jobId}/verify?error=invalid_otp`);
  try {
    await verifyCollectionOtp(jobId, code);
  } catch {
    redirect(`/employee/queue/${jobId}/verify?error=invalid_otp`);
  }
  redirect(`/employee/queue/${jobId}?collection=complete`);
}
