// Kontrak telemetry yang akan diisi gateway ESP32/JR-AIoT.
// Null = sensor belum tersedia; jangan mengisi angka buatan.
export const sensorKeys = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"] as const;
export type SensorKey = (typeof sensorKeys)[number];
export type SensorValues = Record<SensorKey, number | null>;

export type SensorDiagnostics = {
  cwt: { online: boolean; errors: number };
  ebyte: { online: boolean; ch4Connected: boolean; ch5Connected: boolean; errors: number };
  zeh100: { online: boolean; dataValid: boolean; warmupLike: boolean; flags: number | null; errors: number };
};

export type Telemetry = SensorValues & {
  gasModuleC?: number | null;
  sensors?: SensorDiagnostics;
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
  const diagnostics = raw.sensors;
  let sensors: SensorDiagnostics | undefined;
  if (diagnostics !== undefined) {
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return null;
    const value = diagnostics as Record<string, unknown>;
    const nested = (key: string) => value[key] && typeof value[key] === "object" && !Array.isArray(value[key])
      ? value[key] as Record<string, unknown> : null;
    const cwt = nested("cwt"), ebyte = nested("ebyte"), zeh100 = nested("zeh100");
    const count = (obj: Record<string, unknown> | null) =>
      obj && Number.isSafeInteger(obj.errors) && (obj.errors as number) >= 0 && (obj.errors as number) <= 4294967295;
    if (!cwt || !ebyte || !zeh100 || !count(cwt) || !count(ebyte) || !count(zeh100) ||
        typeof cwt.online !== "boolean" || typeof ebyte.online !== "boolean" ||
        typeof ebyte.ch4Connected !== "boolean" || typeof ebyte.ch5Connected !== "boolean" ||
        typeof zeh100.online !== "boolean" || typeof zeh100.dataValid !== "boolean" ||
        typeof zeh100.warmupLike !== "boolean" ||
        !(zeh100.flags === null || (Number.isInteger(zeh100.flags) && (zeh100.flags as number) >= 0 && (zeh100.flags as number) <= 255))) return null;
    sensors = {
      cwt: { online: cwt.online as boolean, errors: cwt.errors as number },
      ebyte: { online: ebyte.online as boolean, ch4Connected: ebyte.ch4Connected as boolean,
        ch5Connected: ebyte.ch5Connected as boolean, errors: ebyte.errors as number },
      zeh100: { online: zeh100.online as boolean, dataValid: zeh100.dataValid as boolean,
        warmupLike: zeh100.warmupLike as boolean, flags: zeh100.flags as number | null,
        errors: zeh100.errors as number }
    };
  }
  let gasModuleC: number | null | undefined;
  if (raw.gasModuleC !== undefined) {
    if (raw.gasModuleC !== null && (typeof raw.gasModuleC !== "number" ||
        !Number.isFinite(raw.gasModuleC) || raw.gasModuleC < -50 || raw.gasModuleC > 150)) return null;
    gasModuleC = raw.gasModuleC as number | null;
  }
  if (present === 0 && !sensors) return null;
  const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "JR-AIoT";
  if (deviceId.length < 1 || deviceId.length > 48 || !/^[a-zA-Z0-9_-]+$/.test(deviceId)) return null;
  return { ...values, ...(sensors ? { sensors } : {}), ...(gasModuleC !== undefined ? { gasModuleC } : {}), deviceId, receivedAt: new Date().toISOString() };
}

export function isTelemetry(value: unknown): value is Telemetry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.receivedAt !== "string" || !Number.isFinite(Date.parse(v.receivedAt))) return false;
  if (typeof v.deviceId !== "string") return false;
  if (!sensorKeys.every((key) => v[key] === null || (typeof v[key] === "number" && Number.isFinite(v[key])))) return false;
  if (v.gasModuleC !== undefined && v.gasModuleC !== null && (typeof v.gasModuleC !== "number" || !Number.isFinite(v.gasModuleC))) return false;
  if (v.sensors !== undefined) {
    const sensors = v.sensors as Record<string, unknown>;
    if (!sensors || typeof sensors !== "object" || Array.isArray(sensors)) return false;
    if (!["cwt", "ebyte", "zeh100"].every(k => sensors[k] !== null && typeof sensors[k] === "object")) return false;
  }
  return true;
}
