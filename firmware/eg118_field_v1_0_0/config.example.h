#pragma once
// COPY to config.h in this sketch folder (gitignored); never commit secrets.
#define WIFI_SSID "YOUR_2_4GHZ_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define DIAG_AP_SSID "ADI-EG118-DIAG"
#define DIAG_AP_PASSWORD "CHANGE_TO_STRONG_AP_PASSWORD"
#define TELEMETRY_URL "https://adi-incinerator.live/api/telemetry"
// For isolated LAN tests: http://192.168.1.10:3000/api/telemetry
#define TELEMETRY_INGEST_KEY "PASTE_LONG_PRIVATE_INGEST_KEY_HERE"
// Letters/numbers/-/_ only, <=48 characters; distinguish from virtual sender.
#define ADI_DEVICE_ID "ADI-EG118-01"
