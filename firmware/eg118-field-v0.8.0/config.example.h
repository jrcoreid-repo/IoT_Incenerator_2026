#pragma once
// COPY this file to config.h (gitignored). Never put actual credentials in GitHub.
#define WIFI_SSID "YOUR_2_4GHZ_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define DIAG_AP_PASSWORD "CHANGE_TO_STRONG_AP_PASSWORD"
#define TELEMETRY_URL "http://192.168.1.10:3000/api/telemetry"
// For Internet deployment: use "https://adi-incinerator.live/api/telemetry"
// Verify CA chain first. Plain HTTP is restricted to private LAN IPs.
#define TELEMETRY_INGEST_KEY "PASTE_LONG_PRIVATE_INGEST_KEY_HERE"
