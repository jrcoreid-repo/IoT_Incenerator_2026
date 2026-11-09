#pragma once

// Make a private copy named config.h; never commit the real Wi-Fi or API key.
// Use the same 2.4 GHz Wi-Fi network as your laptop running Next.js.
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Replace 192.168.1.100 with the laptop's IPv4 from ipconfig.
// IMPORTANT: use the LAPTOP IP, never localhost/127.0.0.1/0.0.0.0.
#define TELEMETRY_URL "http://192.168.1.100:3000/api/telemetry"

// Match TELEMETRY_INGEST_KEY in the laptop project's .env.local.
// Minimum 24 characters; keep this secret and do not paste into chat.
#define TELEMETRY_INGEST_KEY "REPLACE_WITH_PRIVATE_TOKEN_24_PLUS_CHARS"
