# ADI Smart Incinerator — EG118 field firmware v1.0.0

**Status: production-oriented source candidate; on-device commissioning is still mandatory.** This sketch is based on the working read-only Modbus/WDI routines from eg118-reference-v0.7.4. It adds network delivery to the live Next.js dashboard. No Modbus writes, burner, fan, relay or actuator control. NOT a safety-certified incineration control system.

## Confirmed sensor bus and wiring

| Sensor | Slave ID | Modbus read | Data |
|---|---:|---|---|
| Winsen ZEH100 | 1 | FC03 start 0x0001, qty 4 | CO, H2, VOC, module temp, flags |
| CWT-TH01S | 3 | FC03 start 0x0000, qty 2 | RH and ambient temperature (/10) |
| Ebyte ME31-XEXX0600 | 2 | FC04 start 0x0190, qty 6 | **CH4 = CEROBONG / stack**, **CH5 = TUNGKU / furnace**, signed /10 |

- All devices connect **directly** to USR-EG118 via RS485. **9600 baud, 8N1**, UART1 TX GPIO32, RX GPIO33, transceiver DE/RE GPIO12. Keep actual A/B polarity and common reference consistent with validated wiring.
- Poll order ZEH100 → CWT → Ebyte; 250ms inter-sensor spacing; nominal 3s cycle; 1200ms Modbus timeout and 45ms inter-byte guard. CRC16, slave ID, function, response length and exception checks are retained.
- **WORK/WDI GPIO3 is also UART0 RX**. **DO NOT CONNECT USB-TTL TX TO GPIO3/RX0 while running. Do not add Serial.begin().** The hardware-reset issue previously observed resulted from this shared input. WDI timer independently pulses BOOT (100ms high/100ms low), NORMAL (100/900), DEGRADED (100/300). This pulse is NOT a safety-rated watchdog.
- Disconnected Ebyte probes, including raw 0xFC19, produce null instead of a false 0 °C. CH4/CH5 mapping is fixed in JSON and status.
- ZEH100 online means a Modbus reply passed CRC, not necessarily ready for measurement. All-zero response is treated as warm-up-like; two consecutive non-placeholder frames are required to expose numbers. This is an **engineering heuristic only** until the vendor protocol is verified. Flags are passed through, but alarm/fault bit meanings are not asserted as safety truth. Smoke remains null (no calibrated numeric smoke measurement).

## How the new networking works

- Dual-mode Wi-Fi STA + diagnostic SoftAP with configurable WPA password (at least 12 characters). Local diagnostics: **http://192.168.4.1/status**, or the STA private IP. The page reports per-device counts, WDI mode, bus_online, sensor_ready, sensor_fault, warming_up, last HTTP status, and uplink success/errors.
- STA reconnect attempts every **10 seconds**, without reboot. Loss of Wi-Fi does not stop the RS485 polls.
- Every approximately **10 seconds** the main loop snapshots the latest readings to a one-entry FreeRTOS queue. A separate network task performs blocking TLS/HTTPS. Slow network POSTs do not block the serial sensor polling or timer WDI. New snapshots replace queued stale snapshots, with **no offline historical replay**.
- Production telemetry endpoint is **https://adi-incinerator.live/api/telemetry**. TLS validates certificate chain using bundled public ISRG Root X1 and USERTrust RSA roots, with NTP to check the certificate dates; there is no setInsecure(). Redirects are not followed. Plain HTTP is limited to literal private RFC1918 LAN IPs for isolated bench testing.
- Bearer **TELEMETRY_INGEST_KEY** must match the VPS environment. It is different from ADMIN_PASSWORD and SESSION_SECRET. Firmware never exposes this token in the local diagnostic JSON.
- Backend accepts numeric sensor values or null, gasModuleC, and nested diagnostics. It timestamps each accepted reading on the server. Status-only heartbeat is accepted when numeric values are all null.
- Server holds 120 latest readings plus an independent maximum 7-day research archive. Old graphs may remain visible after the gateway goes offline; watch last received timestamp and OFFLINE indicator.

## Install and configure (Arduino IDE)

1. Make a copy of the original working firmware for rollback before installing anything. Open **eg118_field_v1_0_0.ino** from this folder. Use ESP32 by Espressif Systems board package and select the EG118 board's **actual ESP32-S3** target/configuration. Confirm GPIO layout against the real device.
2. Copy **config.example.h → config.h** in this folder. Set WIFI_SSID, WIFI_PASSWORD, DIAG_AP_PASSWORD, TELEMETRY_URL and TELEMETRY_INGEST_KEY. ADI_DEVICE_ID should be a unique ID of at most 48 ASCII letters/digits/underscore/hyphen. This directory's config.h is ignored by Git; never commit or screenshot actual secrets.
3. On the VPS, compare the value of TELEMETRY_INGEST_KEY in the running Next.js release's .env.local without disclosing it. Only update device config.h if it differs; do not rotate production secrets casually.
4. Confirm the live TLS issuer certificate chain maps to public roots in ca_roots.h, e.g. on a trusted machine run:

   ~~~sh
   openssl s_client -connect adi-incinerator.live:443 -servername adi-incinerator.live -showcerts </dev/null
   ~~~

   If CA changes, update the official trust roots; NEVER disable certificate verification.
5. Stop any virtual sender before uploading to avoid polluting physical measurements with dummy telemetry. Upload on a safe bench, with sensor probes cold/controlled and no USB-TTL TX to GPIO3. **No Serial Monitor on GPIO3/UART0 RX.**
6. Join SoftAP with the private diagnostics password; load **http://192.168.4.1/status**. Verify ID1/2/3 online, CWT ambient/RH, CH4/CH5 real connectivity, ZEH warm-up transition, WDI uptime, HTTP success counter incrementing and last_http_status 201.
7. Observe the authenticated web dashboard. Compare physical values against a reference device. Test router offline/reconnect, HTTP failures, disconnected TC probe and ZEH warm-up. Confirm no false numeric zero and status transition to offline. Do not run unattended before tests pass.

## Example heartbeat JSON (illustrative, all values invalid)

~~~json
{
  "deviceId": "ADI-EG118-01",
  "furnace": null,
  "stack": null,
  "ambient": null,
  "humidity": null,
  "co": null,
  "h2": null,
  "voc": null,
  "smoke": null,
  "gasModuleC": null,
  "sensors": {
    "cwt": {"online": false, "errors": 0},
    "ebyte": {"online": false, "ch4Connected": false, "ch5Connected": false, "errors": 0},
    "zeh100": {"online": false, "dataValid": false, "warmupLike": false, "flags": null, "errors": 0}
  }
}
~~~

## Status meaning and expected errors

- Local bus_online = at least one RS485 sensor supplied a valid reply this cycle.
- Local sensor_ready = all three sensors replied, both thermocouples valid, and ZEH data-valid heuristic passed.
- Local sensor_fault = failed RS485 transaction, disconnected TC channel, or nonzero ZEH flags when data-valid (engineering diagnostics, NOT a certified safety signal).
- Local warming_up = ZEH replied but not enough consecutive non-placeholder frames.
- HTTP 201: stored. 400: malformed/out-of-range telemetry. 401: ingest key mismatch. 503: backend/Redis or configuration failure. Negative HTTP codes on local /status: -100 bad URL, -101 clock not synchronized, -102 failed request setup, -103 oversized JSON, -110 disconnected Wi-Fi, -111 placeholder/short token; other negatives may be HTTPClient errors.
- No queue persistence across reboot, OTA, replay, guaranteed Wi-Fi availability or automatic process shutdown. Never use these diagnostics alone to determine incinerator operational safety.

## Build verification

A dedicated GitHub Actions workflow compiles this sketch with Arduino ESP32-S3 core. A clean compile is NOT proof that RS485 electrical wiring, GPIO3 WDI, TLS chain, vendor gas register interpretation or 24/7 uptime works on actual EG118. Hardware field commissioning is still required.
