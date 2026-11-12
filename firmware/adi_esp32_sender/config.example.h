#pragma once

// Copy as config.h and fill in PRIVATE values; never commit config.h.
// ESP32 works on 2.4 GHz Wi-Fi (internet access needed for cloud HTTPS).
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Cloud endpoint of our Caddy + Next.js VPS.
// The TLS client validates the chain and hostname before sending token/data.
#define TELEMETRY_URL "https://adi-incinerator.live/api/telemetry"

// Use TELEMETRY_INGEST_KEY configured on the VPS service, NOT the admin password.
// Must be >=24 chars and identical to the server's ingest key.
#define TELEMETRY_INGEST_KEY "REPLACE_WITH_PRIVATE_VPS_INGEST_TOKEN_24_PLUS_CHARS"

// For isolated offline LAN development only, you can replace TELEMETRY_URL with
// http://192.168.1.100:3000/api/telemetry; public HTTP is intentionally blocked.
