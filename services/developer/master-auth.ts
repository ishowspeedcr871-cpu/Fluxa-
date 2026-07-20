import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createAuditLog } from "@/services/audit/log";
import { verifyPassword } from "@/services/auth/password";

const MASTER_DEVELOPER_COOKIE = "fluxa_master_developer";
const MASTER_DEVELOPER_TTL_HOURS = 8;

type MasterDeveloperIdentity = {
  id: string;
  authenticatedAt: string;
};

function getMasterSecret() {
  return (
    process.env.MASTER_DEVELOPER_SESSION_SECRET ??
    process.env.AUTH_SECRET ??
    "development-master-session-secret"
  );
}

function signPayload(payload: string) {
  return createHmac("sha256", getMasterSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredMasterId() {
  const envId = process.env.MASTER_DEVELOPER_ID;
  if (envId && envId.trim() !== "" && !envId.includes("replace-with-actual")) {
    return envId.trim();
  }
  return null;
}

function configuredMasterPasswordHash() {
  const envHash = process.env.MASTER_DEVELOPER_PASSWORD_HASH;
  if (envHash && envHash.trim() !== "" && !envHash.includes("replace-with-generated")) {
    return envHash.trim();
  }
  return null;
}

function encodeSession(identity: MasterDeveloperIdentity) {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function decodeSession(rawSession?: string): MasterDeveloperIdentity | null {
  const [payload, signature] = rawSession?.split(".") ?? [];
  if (!payload || !signature || !safeEqual(signature, signPayload(payload))) return null;

  try {
    const identity = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as MasterDeveloperIdentity;
    const authenticatedAt = new Date(identity.authenticatedAt).getTime();
    const expiresAt = authenticatedAt + MASTER_DEVELOPER_TTL_HOURS * 60 * 60 * 1000;
    if (!identity.id || Number.isNaN(authenticatedAt) || expiresAt < Date.now()) return null;
    return identity;
  } catch {
    return null;
  }
}

export async function authenticateMasterDeveloper(input: { masterId: string; password: string }) {
  const expectedId = configuredMasterId();
  const expectedPasswordHash = configuredMasterPasswordHash();
  const normalizedInputId = input.masterId.trim();
  
  let validId = expectedId ? (normalizedInputId.toLowerCase() === expectedId.toLowerCase()) : false;
  let validPassword = expectedPasswordHash
    ? verifyPassword(input.password, expectedPasswordHash)
    : false;


  if (!validId || !validPassword) {
    await createAuditLog({
      action: "developer.login_failed",
      entityType: "MasterDeveloperSession",
      severity: "WARNING",
      metadata: { attemptedId: normalizedInputId || "unknown" },
    });
    return false;
  }

  const masterDeveloperId = expectedId ?? "";
  const identity: MasterDeveloperIdentity = {
    id: masterDeveloperId,
    authenticatedAt: new Date().toISOString(),
  };
  const cookieStore = await cookies();
  cookieStore.set(MASTER_DEVELOPER_COOKIE, encodeSession(identity), {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: MASTER_DEVELOPER_TTL_HOURS * 60 * 60,
  });

  await createAuditLog({
    action: "developer.login_succeeded",
    entityType: "MasterDeveloperSession",
    entityId: expectedId,
    metadata: { authenticatedAt: identity.authenticatedAt },
  });
  return true;
}

export async function getMasterDeveloperSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(MASTER_DEVELOPER_COOKIE)?.value);
}

export async function revokeMasterDeveloperSession() {
  const cookieStore = await cookies();
  cookieStore.delete(MASTER_DEVELOPER_COOKIE);
}
