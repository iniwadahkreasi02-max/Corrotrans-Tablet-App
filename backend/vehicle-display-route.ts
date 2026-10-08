import express, {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  GetDriverDisplayProfileResponse,
  RevokeVehicleDisplayResponse,
  UploadDriverPortraitResponse,
  type VehicleDisplayPairingClaimResponse,
  type VehicleDisplayPairingClaimResult,
  type VehicleDisplayPairingRequestResponse,
  type VehicleDisplayPairingRequestStatusResponse,
  type VehicleDisplaySessionResponse,
} from "@workspace/api-zod";
import {
  getSupabaseRealtimeConfig,
  supabaseAuthRequest,
  supabaseStorageRequest,
} from "../lib/supabase";
import { bearerToken, getMobileIdentity, type MobileIdentity } from "./auth";

const router: IRouter = Router();
const PORTRAIT_MAX_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type JsonRecord = Record<string, unknown>;
const pairingRequestWindows = new Map<string, { startedAt: number; count: number }>();

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeVehicleDisplaySession(value: unknown): VehicleDisplaySessionResponse | null {
  if (!isRecord(value)) return null;
  const { pairingId, vehicleId, vehicleLabel, pairedAt, activeTrip, driver } = value;
  if (
    typeof pairingId !== "string" ||
    !UUID_PATTERN.test(pairingId) ||
    typeof vehicleId !== "string" ||
    !UUID_PATTERN.test(vehicleId) ||
    typeof vehicleLabel !== "string" ||
    typeof pairedAt !== "string" ||
    !Number.isFinite(Date.parse(pairedAt))
  ) {
    return null;
  }

  let normalizedDriver: ReturnType<typeof mapProfile>;
  try {
    normalizedDriver = mapProfile(driver);
  } catch {
    return null;
  }

  if (activeTrip === null) {
    return {
      pairingId,
      vehicleId,
      vehicleLabel,
      pairedAt: new Date(pairedAt),
      driver: normalizedDriver,
      activeTrip,
    };
  }
  if (!isRecord(activeTrip)) return null;
  const { id, bookerName, fare, currency, paymentMethod, paymentStatus } = activeTrip;
  if (
    typeof id !== "string" ||
    !UUID_PATTERN.test(id) ||
    typeof bookerName !== "string" ||
    typeof fare !== "number" ||
    !Number.isFinite(fare) ||
    typeof currency !== "string" ||
    !["cash", "qris", "ewallet"].includes(String(paymentMethod)) ||
    !["pending", "paid", "failed", "refunded"].includes(String(paymentStatus))
  ) {
    return null;
  }

  return {
    pairingId,
    vehicleId,
    vehicleLabel,
    pairedAt: new Date(pairedAt),
    driver: normalizedDriver,
    activeTrip: {
      id,
      bookerName,
      fare,
      currency,
      paymentMethod: paymentMethod as "cash" | "qris" | "ewallet",
      paymentStatus: paymentStatus as "pending" | "paid" | "failed" | "refunded",
    },
  };
}

async function readJson(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function displayError(
  res: Response,
  code: "invalid" | "expired" | "revoked" | "already_used" | "no_vehicle",
): void {
  const messages = {
    invalid: "Kode pairing tidak valid.",
    expired: "Kode pairing sudah kedaluwarsa.",
    revoked: "Kode pairing sudah dicabut.",
    already_used: "Kode pairing sudah pernah digunakan.",
    no_vehicle: "Akun driver belum memiliki kendaraan terdaftar.",
  };
  res.status(422).json({ code, error: messages[code] });
}

function allowPairingRequest(req: Request, res: Response): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const window = pairingRequestWindows.get(key);
  if (!window || now - window.startedAt >= 60_000) {
    pairingRequestWindows.set(key, { startedAt: now, count: 1 });
    if (pairingRequestWindows.size > 2048) {
      for (const [ip, value] of pairingRequestWindows) {
        if (now - value.startedAt >= 60_000) pairingRequestWindows.delete(ip);
      }
    }
    return true;
  }
  if (window.count >= 10) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((window.startedAt + 60_000 - now) / 1000))));
    res.status(429).json({ error: "Terlalu banyak permintaan QR pairing. Coba lagi sebentar." });
    return false;
  }
  window.count += 1;
  return true;
}

async function rpc(
  name: string,
  args: JsonRecord,
  userToken?: string,
): Promise<{ response: globalThis.Response; payload: unknown }> {
  const response = await supabaseAuthRequest(`/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
    },
    body: JSON.stringify(args),
  });
  return { response, payload: await readJson(response) };
}

function errorStatus(response: globalThis.Response): number {
  if (response.status === 401) return 401;
  if (response.status === 403) return 403;
  if (response.status === 400) return 400;
  return 503;
}

async function requireDriver(
  req: Request,
  res: Response,
): Promise<{ token: string; identity: MobileIdentity } | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Sesi driver diperlukan." });
    return null;
  }
  const identity = await getMobileIdentity(token);
  if (!identity) {
    res.status(403).json({ error: "Sesi ini bukan akun driver." });
    return null;
  }
  if (identity.role !== "driver" || identity.driverVerificationStatus !== "approved") {
    res.status(403).json({
      error: identity.role !== "driver"
        ? "Fitur ini hanya tersedia untuk driver."
        : "Fitur ini tersedia setelah pendaftaran driver disetujui.",
    });
    return null;
  }
  return { token, identity };
}

function photoUrlFor(path: unknown, updatedAt: unknown): string | null {
  if (typeof path !== "string" || !path) return null;
  if (!/^[0-9a-f-]{36}\/driver-portrait\.jpg$/i.test(path)) {
    throw new Error("Invalid driver portrait storage path");
  }
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Invalid driver portrait update timestamp");
  }
  const origin = process.env.SUPABASE_URL;
  if (!origin) throw new Error("SUPABASE_URL is required for vehicle display portraits.");
  return `${new URL(origin).origin}/storage/v1/object/public/avatars/${path}?v=${encodeURIComponent(updatedAt)}`;
}

function mapProfile(value: unknown) {
  if (!isRecord(value)
      || typeof value.name !== "string"
      || typeof value.plate !== "string"
      || typeof value.vehicleModel !== "string") {
    throw new Error("Invalid driver display profile response");
  }
  return GetDriverDisplayProfileResponse.parse({
    name: value.name,
    plate: value.plate,
    vehicleModel: value.vehicleModel,
    photoUrl: photoUrlFor(value.photo_path, value.photo_updated_at),
  });
}

async function readVehicleDisplaySession(sessionHash: string) {
  const sessionRead = await rpc(
    "corrotrans_vehicle_display_session",
    { p_session_token_hash: sessionHash },
  );
  if (!sessionRead.response.ok || !isRecord(sessionRead.payload) || typeof sessionRead.payload.error === "string") {
    return sessionRead;
  }

  const profileRead = await rpc(
    "corrotrans_vehicle_display_driver_profile",
    { p_session_token_hash: sessionHash },
  );
  if (!profileRead.response.ok || isRecord(profileRead.payload) && typeof profileRead.payload.error === "string") {
    return profileRead;
  }

  const driver = mapProfile(profileRead.payload);
  return {
    response: sessionRead.response,
    payload: { ...sessionRead.payload, driver },
  };
}

const portraitBodyParser: RequestHandler = (req, res, next): void => {
  express.raw({ type: "image/jpeg", limit: PORTRAIT_MAX_BYTES })(req, res, (error?: unknown) => {
    if (error) {
      const status = isRecord(error) && typeof error.status === "number" ? error.status : 400;
      res.status(status === 413 ? 413 : 400).json({
        error: status === 413
          ? "Ukuran foto maksimal 2 MB."
          : "Unggah foto JPEG yang valid.",
      });
      return;
    }
    next();
  });
};

router.post("/vehicle-display/pairing-requests", async (req, res): Promise<void> => {
  if (!allowPairingRequest(req, res)) return;
  const pairingCode = `CT-${randomBytes(16).toString("hex").toUpperCase()}`;
  const sessionToken = randomBytes(32).toString("hex");
  const codeHash = createHash("sha256").update(pairingCode).digest("hex");
  const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");

  try {
    const { response, payload } = await rpc("corrotrans_vehicle_display_request_create", {
      p_code_hash: codeHash,
      p_session_token_hash: sessionTokenHash,
    });
    const request = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null;
    if (!response.ok || !request
        || typeof request.request_id !== "string"
        || !UUID_PATTERN.test(request.request_id)
        || typeof request.expires_at !== "string"
        || !Number.isFinite(Date.parse(request.expires_at))) {
      req.log.error({ status: response.status }, "Vehicle display pairing request creation failed");
      res.status(503).json({ error: "QR pairing belum dapat dibuat." });
      return;
    }

    res.set("Cache-Control", "no-store");
    const result: VehicleDisplayPairingRequestResponse = {
      requestId: request.request_id,
      pairingCode,
      sessionToken,
      expiresAt: new Date(request.expires_at),
    };
    res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display pairing request creation failed");
    res.status(503).json({ error: "QR pairing belum dapat dibuat." });
  }
});

router.get("/vehicle-display/pairing-requests/:requestId", async (req, res): Promise<void> => {
  const requestId = req.params.requestId;
  const sessionToken = bearerToken(req);
  if (!UUID_PATTERN.test(requestId)) {
    res.status(400).json({ error: "ID permintaan pairing tidak valid." });
    return;
  }
  if (!sessionToken || !/^[a-f0-9]{64}$/i.test(sessionToken)) {
    res.status(401).json({ error: "Sesi tablet tidak valid." });
    return;
  }

  try {
    const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const { response, payload } = await rpc("corrotrans_vehicle_display_request_status", {
      p_request_id: requestId,
      p_session_token_hash: sessionTokenHash,
    });
    if (!response.ok || !isRecord(payload) || typeof payload.status !== "string") {
      req.log.error({ status: response.status }, "Vehicle display pairing request status failed");
      res.status(503).json({ error: "Status pairing belum dapat dimuat." });
      return;
    }

    const status = payload.status;
    if (!["pending", "claimed", "expired", "revoked", "invalid"].includes(status)) {
      throw new Error("Invalid vehicle display pairing request status");
    }
    const result: VehicleDisplayPairingRequestStatusResponse = { status } as VehicleDisplayPairingRequestStatusResponse;
    if (status === "claimed") {
      if (typeof payload.pairing_id !== "string" || !UUID_PATTERN.test(payload.pairing_id)
          || typeof payload.vehicle_id !== "string" || !UUID_PATTERN.test(payload.vehicle_id)
          || typeof payload.paired_at !== "string" || !Number.isFinite(Date.parse(payload.paired_at))) {
        throw new Error("Invalid claimed vehicle display request");
      }
      result.pairingId = payload.pairing_id;
      result.vehicleId = payload.vehicle_id;
      result.vehicleLabel = "Kendaraan";
      result.pairedAt = new Date(payload.paired_at);
    }
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display pairing request status failed");
    res.status(503).json({ error: "Status pairing belum dapat dimuat." });
  }
});

router.post("/vehicle-display/pair", async (req, res): Promise<void> => {
  const codeValue = isRecord(req.body) ? req.body.pairingCode : null;
  if (typeof codeValue !== "string" || codeValue.trim().length < 4 || codeValue.trim().length > 40) {
    res.status(400).json({ error: "Kode pairing tidak valid." });
    return;
  }

  const pairingCode = codeValue.trim().toUpperCase();
  const codeHash = createHash("sha256").update(pairingCode).digest("hex");
  const sessionToken = randomBytes(32).toString("hex");
  const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
  try {
    const claim = await rpc("claim_vehicle_display_pairing", {
      p_code_hash: codeHash,
      p_session_token_hash: sessionTokenHash,
    });
    if (!claim.response.ok) throw new Error(`Pairing claim failed: ${claim.response.status}`);
    const pairing = Array.isArray(claim.payload) && isRecord(claim.payload[0])
      ? claim.payload[0]
      : null;

    if (!pairing) {
      const inspected = await rpc("vehicle_display_pairing_error", { p_code_hash: codeHash });
      const code = inspected.response.ok && typeof inspected.payload === "string"
        && ["invalid", "expired", "revoked", "already_used"].includes(inspected.payload)
        ? inspected.payload as "invalid" | "expired" | "revoked" | "already_used"
        : "invalid";
      displayError(res, code);
      return;
    }

    const pairingId = typeof pairing.id === "string" ? pairing.id : "";
    const vehicleId = typeof pairing.vehicle_id === "string" ? pairing.vehicle_id : "";
    if (!UUID_PATTERN.test(pairingId) || !UUID_PATTERN.test(vehicleId)) {
      throw new Error("Invalid vehicle pairing claim response");
    }
    if (typeof pairing.used_at !== "string" || !Number.isFinite(Date.parse(pairing.used_at))) {
      throw new Error("Invalid vehicle pairing timestamp");
    }
    const pairedAt = new Date(pairing.used_at);
    res.set("Cache-Control", "no-store");
    const result: VehicleDisplayPairingClaimResponse = {
      pairingId,
      vehicleId,
      vehicleLabel: "Kendaraan",
      sessionToken,
      pairedAt,
    };
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display pairing claim failed");
    res.status(503).json({ error: "Pairing belum dapat diselesaikan." });
  }
});

router.get("/vehicle-display/session", async (req, res): Promise<void> => {
  const sessionToken = bearerToken(req);
  if (!sessionToken || !/^[a-f0-9]{64}$/i.test(sessionToken)) {
    res.status(401).json({ code: "invalid", error: "Sesi tablet tidak valid." });
    return;
  }
  const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
  try {
    const { response, payload } = await readVehicleDisplaySession(sessionHash);
    if (!response.ok) {
      req.log.error({ status: response.status }, "Vehicle display session RPC failed");
      res.status(503).json({ error: "Data perjalanan belum dapat dimuat." });
      return;
    }
    if (!isRecord(payload)) {
      res.status(401).json({ code: "invalid", error: "Sesi tablet tidak valid." });
      return;
    }
    if (typeof payload.error === "string") {
      const code = ["invalid", "expired", "revoked"].includes(payload.error)
        ? payload.error as "invalid" | "expired" | "revoked"
        : "invalid";
      const messages = {
        invalid: "Sesi tablet tidak valid.",
        expired: "Pairing tablet sudah kedaluwarsa.",
        revoked: "Pairing tablet sudah dicabut.",
      };
      res.status(401).json({ code, error: messages[code] });
      return;
    }
    const parsed = normalizeVehicleDisplaySession(payload);
    if (!parsed) {
      req.log.error("Vehicle display session returned invalid profile or trip data");
      res.status(503).json({ error: "Profil kendaraan belum dapat dimuat." });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json(parsed);
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display session read failed");
    res.status(503).json({ error: "Data perjalanan belum dapat dimuat." });
  }
});

router.get("/vehicle-display/events", async (req, res): Promise<void> => {
  const sessionToken = bearerToken(req);
  if (!sessionToken || !/^[a-f0-9]{64}$/i.test(sessionToken)) {
    res.status(401).json({ code: "invalid", error: "Sesi tablet tidak valid." });
    return;
  }

  const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
  let realtimeConfig: ReturnType<typeof getSupabaseRealtimeConfig>;
  let initialPayload: VehicleDisplaySessionResponse;
  try {
    const sessionRead = await readVehicleDisplaySession(sessionHash);
    if (!sessionRead.response.ok) {
      req.log.error({ status: sessionRead.response.status }, "Vehicle display event authorization failed");
      res.status(503).json({ error: "Koneksi Realtime kendaraan belum tersedia." });
      return;
    }
    if (isRecord(sessionRead.payload) && typeof sessionRead.payload.error === "string") {
      const code = ["expired", "revoked"].includes(sessionRead.payload.error)
        ? sessionRead.payload.error
        : "invalid";
      const messages = {
        invalid: "Sesi tablet tidak valid.",
        expired: "Pairing tablet sudah kedaluwarsa.",
        revoked: "Pairing tablet sudah dicabut.",
      };
      res.status(401).json({ code, error: messages[code as keyof typeof messages] });
      return;
    }
    const parsed = normalizeVehicleDisplaySession(sessionRead.payload);
    if (!parsed) {
      req.log.error("Vehicle display event authorization returned invalid session data");
      res.status(503).json({ error: "Data kendaraan belum dapat diverifikasi." });
      return;
    }
    initialPayload = parsed;
    realtimeConfig = getSupabaseRealtimeConfig();
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display event authorization failed");
    res.status(503).json({ error: "Koneksi Realtime kendaraan belum tersedia." });
    return;
  }

  let client: ReturnType<typeof createClient>;
  try {
    client = createClient(realtimeConfig.origin, realtimeConfig.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display Realtime client could not start");
    res.status(503).json({ error: "Koneksi Realtime kendaraan belum tersedia." });
    return;
  }

  const vehicleId = initialPayload.vehicleId;
  let channel: ReturnType<typeof client.channel> | undefined;
  let stopped = false;
  let refreshing = false;
  let refreshQueued = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let sessionCheck: ReturnType<typeof setInterval> | undefined;

  const writeEvent = (event: string, payload: unknown): void => {
    if (stopped || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const stop = (event?: string, payload?: unknown): void => {
    if (stopped) return;
    if (event && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
    stopped = true;
    if (heartbeat) clearInterval(heartbeat);
    if (sessionCheck) clearInterval(sessionCheck);
    if (!res.writableEnded) res.end();
    if (channel) {
      void client.removeChannel(channel).catch((error: unknown) => {
        req.log.warn({ err: error }, "Vehicle display Realtime channel cleanup failed");
      });
    }
    client.realtime.disconnect();
  };

  const pushLatestSession = async (): Promise<void> => {
    if (stopped) return;
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshQueued = false;
        const sessionRead = await readVehicleDisplaySession(sessionHash);
        if (!sessionRead.response.ok) {
          throw new Error(`Vehicle display Realtime session read failed: ${sessionRead.response.status}`);
        }
        if (isRecord(sessionRead.payload) && typeof sessionRead.payload.error === "string") {
          const code = ["expired", "revoked"].includes(sessionRead.payload.error)
            ? sessionRead.payload.error
            : "invalid";
          stop("session-ended", { code, error: "Sesi tablet sudah berakhir. Pasangkan kembali." });
          return;
        }
        const parsed = normalizeVehicleDisplaySession(sessionRead.payload);
        if (!parsed || parsed.vehicleId !== vehicleId) {
          throw new Error("Vehicle display Realtime returned an invalid vehicle session");
        }
        writeEvent("session", parsed);
      } while (refreshQueued && !stopped);
    } catch (error) {
      req.log.warn({ err: error }, "Vehicle display Realtime refresh failed");
      stop("stream-error", { error: "Pembaruan kendaraan terganggu. Coba sambungkan kembali." });
    } finally {
      refreshing = false;
    }
  };

  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  writeEvent("session", initialPayload);

  res.on("close", () => stop());
  heartbeat = setInterval(() => {
    if (!stopped && !res.writableEnded) res.write(": keep-alive\n\n");
  }, 20_000);
  sessionCheck = setInterval(() => {
    void pushLatestSession();
  }, 60_000);

  try {
    channel = client
      .channel(`vehicle-display:${vehicleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vehicle_display_live_state",
          filter: `vehicle_id=eq.${vehicleId}`,
        },
        () => {
          void pushLatestSession();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void pushLatestSession();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          req.log.warn({ status }, "Vehicle display Realtime subscription ended");
          stop("stream-error", { error: "Koneksi Realtime kendaraan terputus." });
        }
      });
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display Realtime subscription failed");
    stop("stream-error", { error: "Koneksi Realtime kendaraan belum tersedia." });
  }
});

router.post("/vehicle-display/unpair", async (req, res): Promise<void> => {
  const sessionToken = bearerToken(req);
  const pairingId = isRecord(req.body) && typeof req.body.pairingId === "string"
    ? req.body.pairingId
    : "";
  if (!sessionToken || !/^[a-f0-9]{64}$/i.test(sessionToken) || !UUID_PATTERN.test(pairingId)) {
    res.status(400).json({ error: "Sesi atau ID pairing tidak valid." });
    return;
  }
  try {
    const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
    const { response, payload } = await rpc("corrotrans_vehicle_display_unpair", {
      p_pairing_id: pairingId,
      p_session_token_hash: sessionHash,
    });
    if (!response.ok) {
      req.log.error({ status: response.status }, "Vehicle display unpair RPC failed");
      res.status(503).json({ error: "Pairing belum dapat dicabut." });
      return;
    }
    if (payload !== true) {
      res.status(401).json({ code: "invalid", error: "Sesi tablet tidak valid atau sudah dicabut." });
      return;
    }
    res.json({ revoked: true });
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display unpair failed");
    res.status(503).json({ error: "Pairing belum dapat dicabut." });
  }
});

router.post("/mobile/vehicle-display/code", (_req, res): void => {
  res.status(410).json({ error: "Kode lama tidak aktif. Tampilkan QR dari tablet kendaraan." });
});

router.post("/mobile/vehicle-display/claim", async (req, res): Promise<void> => {
  try {
    const session = await requireDriver(req, res);
    if (!session) return;
    const codeValue = isRecord(req.body) ? req.body.pairingCode : null;
    if (typeof codeValue !== "string") {
      displayError(res, "invalid");
      return;
    }
    const codeSuffix = codeValue.trim().toUpperCase().replace(/^CT-/, "");
    if (!/^[A-F0-9]{32}$/.test(codeSuffix)) {
      displayError(res, "invalid");
      return;
    }

    const pairingCode = `CT-${codeSuffix}`;
    const codeHash = createHash("sha256").update(pairingCode).digest("hex");
    const { response, payload } = await rpc(
      "corrotrans_vehicle_display_request_claim",
      { p_code_hash: codeHash },
      session.token,
    );
    if (!response.ok) {
      req.log.error({ status: response.status }, "Vehicle display pairing request claim failed");
      res.status(errorStatus(response)).json({ error: "Pairing tablet belum dapat diselesaikan." });
      return;
    }
    if (!isRecord(payload)) {
      throw new Error("Invalid vehicle display pairing claim response");
    }
    if (typeof payload.error === "string") {
      const code = ["invalid", "expired", "revoked", "already_used", "no_vehicle"].includes(payload.error)
        ? payload.error as "invalid" | "expired" | "revoked" | "already_used" | "no_vehicle"
        : "invalid";
      displayError(res, code);
      return;
    }
    if (typeof payload.pairing_id !== "string" || !UUID_PATTERN.test(payload.pairing_id)
        || typeof payload.vehicle_id !== "string" || !UUID_PATTERN.test(payload.vehicle_id)
        || typeof payload.paired_at !== "string" || !Number.isFinite(Date.parse(payload.paired_at))) {
      throw new Error("Invalid vehicle display pairing claim response");
    }
    const result: VehicleDisplayPairingClaimResult = {
      pairingId: payload.pairing_id,
      vehicleId: payload.vehicle_id,
      vehicleLabel: "Kendaraan",
      pairedAt: new Date(payload.paired_at),
    };
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display pairing request claim failed");
    res.status(503).json({ error: "Pairing tablet belum dapat diselesaikan." });
  }
});

router.post("/mobile/vehicle-display/pair", (_req, res): void => {
  res.status(410).json({ error: "Endpoint pairing lama sudah tidak aktif. Gunakan pairing kendaraan yang tervalidasi." });
});

router.get("/mobile/vehicle-display/current", (_req, res): void => {
  res.status(410).json({ error: "Endpoint display lama sudah tidak aktif. Gunakan sesi pairing kendaraan." });
});

router.post("/mobile/vehicle-display/revoke", async (req, res): Promise<void> => {
  try {
    const session = await requireDriver(req, res);
    if (!session) return;
    const { response, payload } = await rpc(
      "corrotrans_vehicle_display_revoke",
      {},
      session.token,
    );
    if (!response.ok || payload !== true) {
      req.log.error({ status: response.status }, "Vehicle display revoke failed");
      res.status(response.ok ? 503 : errorStatus(response)).json({ error: "Sesi display belum dapat dicabut." });
      return;
    }
    res.json(RevokeVehicleDisplayResponse.parse({ revoked: true }));
  } catch (error) {
    req.log.error({ err: error }, "Vehicle display revoke failed");
    res.status(503).json({ error: "Sesi display belum dapat dicabut." });
  }
});

router.get("/mobile/driver/display-profile", async (req, res): Promise<void> => {
  try {
    const session = await requireDriver(req, res);
    if (!session) return;
    const { response, payload } = await rpc(
      "corrotrans_driver_display_profile",
      {},
      session.token,
    );
    if (!response.ok) {
      req.log.error({ status: response.status }, "Driver display profile read failed");
      res.status(errorStatus(response)).json({ error: "Profil display belum dapat dimuat." });
      return;
    }
    res.json(mapProfile(payload));
  } catch (error) {
    req.log.error({ err: error }, "Driver display profile read failed");
    res.status(503).json({ error: "Profil display belum dapat dimuat." });
  }
});

router.put("/mobile/driver/portrait", portraitBodyParser, async (req, res): Promise<void> => {
  const contentType = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  const file = Buffer.isBuffer(req.body) ? req.body : null;
  if (contentType !== "image/jpeg" || !file || file.byteLength === 0) {
    res.status(400).json({ error: "Unggah berkas JPEG yang valid." });
    return;
  }
  if (file.byteLength > PORTRAIT_MAX_BYTES) {
    res.status(413).json({ error: "Ukuran foto maksimal 2 MB." });
    return;
  }
  if (file.byteLength < 3 || file[0] !== 0xff || file[1] !== 0xd8 || file[2] !== 0xff) {
    res.status(400).json({ error: "Berkas bukan gambar JPEG yang valid." });
    return;
  }

  try {
    const session = await requireDriver(req, res);
    if (!session) return;
    const objectPath = `${session.identity.userId}/driver-portrait.jpg`;
    const uploadResponse = await supabaseStorageRequest(
      `/object/avatars/${objectPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "image/jpeg",
          "Content-Length": String(file.byteLength),
          "x-upsert": "true",
        },
        body: file,
      },
    );
    if (!uploadResponse.ok) {
      req.log.error({ status: uploadResponse.status }, "Driver portrait upload failed");
      res.status(503).json({ error: "Foto driver belum dapat disimpan." });
      return;
    }
    const { response, payload } = await rpc(
      "corrotrans_driver_set_display_photo",
      { p_photo_path: objectPath },
      session.token,
    );
    if (!response.ok) {
      req.log.error({ status: response.status }, "Driver portrait profile update failed");
      res.status(errorStatus(response)).json({ error: "Profil foto driver belum dapat diperbarui." });
      return;
    }
    res.json(UploadDriverPortraitResponse.parse(mapProfile(payload)));
  } catch (error) {
    req.log.error({ err: error }, "Driver portrait update failed");
    res.status(503).json({ error: "Foto driver belum dapat disimpan." });
  }
});

export default router;