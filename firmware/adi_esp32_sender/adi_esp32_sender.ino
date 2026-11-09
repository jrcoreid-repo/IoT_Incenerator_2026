/*
  ADI Smart Incinerator - ESP32 Wi-Fi telemetry sender
  Arduino IDE, ESP32 by Espressif Systems (generic ESP32 / ESP32-S3 / ESP32-C3).
  Sends DUMMY readings to Next.js /api/telemetry every 10 seconds.

  1) Copy config.example.h to config.h inside this sketch folder.
  2) Fill Wi-Fi, laptop IPv4, TELEMETRY_INGEST_KEY (same as .env.local).
  3) Start Next.js on the laptop: npm run dev -- -H 0.0.0.0
  4) Upload and open Serial Monitor @ 115200 baud.

  This is TEST DATA, not calibrated physical sensor measurements.
  For local LAN HTTP only; use verified TLS HTTPS before remote deployment.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>
#include "config.h"

static const uint32_t SEND_INTERVAL_MS = 10000;
static const uint32_t WIFI_RETRY_MS = 10000;
static const uint32_t PHASE_DURATION_MS = 25000;
static const uint32_t HTTP_TIMEOUT_MS = 4500;
static const char *DEVICE_ID = "ESP32-ADI-01";

// Phases: idle, heating, active, warning, critical, cooling.
// Each row: furnace, stack, ambient, humidity, CO, H2, VOC, smoke.
static const float TARGETS[6][8] = {
  { 54.0f,  41.0f, 29.4f, 70.0f, 11.0f,  2.3f,  18.0f, 0.012f },
  {149.0f,  84.0f, 30.0f, 66.0f, 31.0f,  5.7f,  53.0f, 0.030f },
  {302.0f, 151.0f, 31.3f, 64.0f, 24.0f,  6.0f,  37.0f, 0.023f },
  {188.0f, 136.0f, 32.5f, 61.0f, 71.0f, 11.1f, 110.0f, 0.065f },
  {156.0f, 142.0f, 33.8f, 59.0f,132.0f, 18.2f, 185.0f, 0.098f },
  { 98.0f,  67.0f, 30.6f, 66.0f, 28.0f,  5.2f,  47.0f, 0.035f }
};
static const char *PHASES[] = {"IDLE", "HEATING", "ACTIVE", "WARNING", "CRITICAL", "COOLING"};

uint32_t lastSend = 0;
uint32_t lastWiFiAttempt = 0;
uint32_t startedAt = 0;
bool firstSend = true;

float clampValue(float v, float low, float high) {
  return fminf(fmaxf(v, low), high);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const uint32_t now = millis();
  if (lastWiFiAttempt != 0 && (uint32_t)(now - lastWiFiAttempt) < WIFI_RETRY_MS) return;
  lastWiFiAttempt = now;
  Serial.println("[WiFi] Connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void makeReadings(float out[8], unsigned int &stage, uint32_t elapsedMs) {
  const uint32_t phaseIndex = elapsedMs / PHASE_DURATION_MS;
  stage = phaseIndex % 6;
  const unsigned int previous = (stage + 5) % 6;
  const float elapsedInPhase = (float)(elapsedMs % PHASE_DURATION_MS);
  const float progress = phaseIndex == 0 ? 1.0f :
                         clampValue(elapsedInPhase / (PHASE_DURATION_MS * 0.6f), 0.0f, 1.0f);

  for (int i = 0; i < 8; ++i) {
    const float base = TARGETS[previous][i] +
                       (TARGETS[stage][i] - TARGETS[previous][i]) * progress;
    const float wiggle = (i == 7 ? 0.002f : i == 2 ? 0.16f : i == 3 ? 0.6f : 1.4f) *
                         sinf((elapsedMs / 1000.0f) * 0.41f + i * 1.31f);
    out[i] = fmaxf(0.0f, base + wiggle);
  }
  out[3] = clampValue(out[3], 0.0f, 100.0f);
}

void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] Wi-Fi offline. Skipping.");
    return;
  }
  const String endpoint = String(TELEMETRY_URL);
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    Serial.println("[ESP32] Invalid TELEMETRY_URL. Use http://<laptop-ip>:3000/api/telemetry");
    return;
  }
  // Avoid silent insecure HTTPS fallback: remote TLS needs its own verified CA setup.
  if (endpoint.startsWith("https://")) {
    Serial.println("[ESP32] HTTPS requires a certificate-validated client. Use HTTP on isolated test LAN.");
    return;
  }

  float v[8] = {};
  unsigned int stage = 0;
  makeReadings(v, stage, (uint32_t)(millis() - startedAt));

  char payload[420];
  int count = snprintf(payload, sizeof(payload),
    "{\"deviceId\":\"%s\",\"furnace\":%.1f,\"stack\":%.1f,\"ambient\":%.1f,"
    "\"humidity\":%.1f,\"co\":%.1f,\"h2\":%.1f,\"voc\":%.1f,\"smoke\":%.3f}",
    DEVICE_ID, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
  if (count <= 0 || count >= (int)sizeof(payload)) {
    Serial.println("[ESP32] JSON buffer too small.");
    return;
  }

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, endpoint)) {
    Serial.println("[ESP32] HTTP connection setup failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + TELEMETRY_INGEST_KEY);
  http.addHeader("Cache-Control", "no-store");
  const int status = http.POST((uint8_t *)payload, (size_t)count);
  const String response = http.getString();
  http.end();

  Serial.printf("[ESP32] %-8s | HTTP %d | Tungku %.1f C | CO %.1f ppm | VOC %.1f ppm\n",
                PHASES[stage], status, v[0], v[4], v[6]);
  if (status != 201) {
    Serial.printf("[ESP32] Error: %s\n", response.c_str());
    if (status < 0) Serial.println("[ESP32] Check IP laptop, Next.js -H 0.0.0.0, Wi-Fi and Windows Firewall.");
    if (status == 401) Serial.println("[ESP32] Check TELEMETRY_INGEST_KEY matches .env.local.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\nADI Smart Incinerator - ESP32 dummy sender");
  Serial.println("Data is generated for engineering tests only.");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startedAt = millis();
  connectWiFi();
}

void loop() {
  connectWiFi();
  static bool printedIP = false;
  if (WiFi.status() == WL_CONNECTED && !printedIP) {
    Serial.print("[WiFi] Connected, ESP IP: ");
    Serial.println(WiFi.localIP());
    printedIP = true;
  }
  if (WiFi.status() != WL_CONNECTED) printedIP = false;

  const uint32_t now = millis();
  if (firstSend || (uint32_t)(now - lastSend) >= SEND_INTERVAL_MS) {
    firstSend = false;
    lastSend = now;
    sendTelemetry();
  }
  delay(20);
}
