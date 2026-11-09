// Kontrak telemetry yang akan diisi gateway ESP32/JR-AIoT.
// Null = sensor belum tersedia; jangan mengisi angka buatan.
export const sensorKeys = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"] as const;
export type SensorKey = (typeof sensorKeys)[number];
export type SensorValues = Record<SensorKey, number | null>;

export type Telemetry = SensorValues & {
  deviceId: string;
  receivedAt: string; // Waktu penerimaan server, ISO UTC
};

export type TelemetryResponse = {
  latest: Telemetry | null;
  history: Telemetry[];
  storageReady: boolean;
};

const ranges: Record<SensorKey, [number, number]> = {
  furnace: [-50, 1600],
  stack: [-50, 1600],
  ambient: [-50, 100],
  humidity: [0, 100],
  co: [0, 100000],
  h2: [0, 100000],
  voc: [0, 100000],
  smoke: [0, 100]
};

export function parseTelemetry(body: unknown): Telemetry | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const values = {} as SensorValues;
  let present = 0;
  for (const key of sensorKeys) {
    const value = raw[key];
    if (value === undefined || value === null) {
      values[key] = null;
      continue;
    }
    const [minimum, maximum] = ranges[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
      return null;
    }
    values[key] = value;
    present++;
  }
  if (present === 0) return null;
  const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "JR-AIoT";
  if (deviceId.length < 1 || deviceId.length > 48 || !/^[a-zA-Z0-9_-]+$/.test(deviceId)) return null;
  return { ...values, deviceId, receivedAt: new Date().toISOString() };
}

export function isTelemetry(value: unknown): value is Telemetry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.receivedAt !== "string" || !Number.isFinite(Date.parse(v.receivedAt))) return false;
  if (typeof v.deviceId !== "string") return false;
  return sensorKeys.every((key) => v[key] === null || (typeof v[key] === "number" && Number.isFinite(v[key])));
}
