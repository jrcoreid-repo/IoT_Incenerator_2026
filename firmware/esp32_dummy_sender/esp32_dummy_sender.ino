/*
  ADI Smart Incinerator - ESP32 Wi-Fi Dummy Telemetry (Arduino IDE)
  Board: ESP32 Dev Module / ESP32-S3 / ESP32-C3 (Arduino-ESP32 core)
  Local test ONLY. Not a sensor reading or an emission assessment.
  Set Wi-Fi, laptop IP, and ingest token before uploading.
  Do not commit real passwords or ingest tokens to public GitHub.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>

const char* WIFI_SSID = "GANTI_WIFI_SSID";
const char* WIFI_PASSWORD = "GANTI_PASSWORD_WIFI";
const char* SERVER_URL = "http://172.20.10.2:3000/api/telemetry";
const char* INGEST_KEY = "GANTI_TELEMETRY_INGEST_KEY_DARI_ENV_LOCAL";
const char* DEVICE_ID = "ESP32-ADI-DUMMY-01";

// Interval normal pengiriman telemetry: 10 detik.
// Interval retry Wi-Fi: 10 detik, tanpa blocking delay.
// Retry HTTP meningkat 10, 20, 40, 80, 120 detik ketika server down.
constexpr unsigned long SEND_INTERVAL_MS = 10000;
constexpr unsigned long WIFI_RETRY_MS = 10000;
constexpr unsigned long HTTP_BACKOFF_MAX_MS = 120000;
constexpr unsigned long HTTP_TIMEOUT_MS = 5000;
constexpr unsigned int WIFI_RECOVER_AFTER_HTTP_FAILURES = 3;
unsigned long lastWiFiAttemptAt = 0;
unsigned long lastSendAt = 0;
unsigned long nextSendAt = 0;
unsigned long sentCount = 0;
unsigned long failedCount = 0;
unsigned int consecutiveHttpFailures = 0;
bool wasConnected = false;
bool permanentConfigError = false;

void startWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptAt = millis();
  Serial.println("[WiFi] Connecting / reconnecting...");
}

void maintainWiFi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wasConnected) {
      Serial.print("[WiFi] Connected, IP: ");
      Serial.println(WiFi.localIP());
      Serial.print("[HTTP] Target: ");
      Serial.println(SERVER_URL);
      consecutiveHttpFailures = 0;
      nextSendAt = now;
    }
    wasConnected = true;
    return;
  }
  if (wasConnected) Serial.println("[WiFi] Disconnected, reconnecting automatically.");
  wasConnected = false;
  if ((unsigned long)(now - lastWiFiAttemptAt) >= WIFI_RETRY_MS) {
    WiFi.disconnect(false);
    startWiFi();
  }
}

String buildPayload() {
  // Six simulated process phases, 25 seconds each.
  const float elapsed = millis() / 1000.0f;
  const int phase = static_cast<int>(elapsed / 25.0f) % 6;
  const float furnaceTargets[] = {54, 149, 302, 188, 156, 98};
  const float stackTargets[] = {41, 84, 151, 136, 142, 67};
  const float coTargets[] = {11, 31, 24, 71, 132, 28};
  const float vocTargets[] = {18, 53, 37, 110, 185, 47};
  const float h2Targets[] = {2.3, 5.7, 6.0, 11.1, 18.2, 5.2};
  const float smokeTargets[] = {0.012, 0.030, 0.023, 0.065, 0.098, 0.035};
  const float ambientTargets[] = {29.4, 30.0, 31.3, 32.5, 33.8, 30.6};
  const float humidityTargets[] = {70, 66, 64, 61, 59, 66};

  const float drift = sinf(elapsed * 0.41f) * 1.1f;
  const float furnace = furnaceTargets[phase] + drift;
  const float stack = stackTargets[phase] + drift * 0.7f;
  const float co = coTargets[phase] + fabsf(drift);
  const float voc = vocTargets[phase] + fabsf(drift) * 1.2f;
  const float h2 = h2Targets[phase] + fabsf(drift) * 0.3f;
  const float smoke = smokeTargets[phase] + fabsf(drift) * 0.001f;
  const float ambient = ambientTargets[phase] + drift * 0.1f;
  const float humidity = humidityTargets[phase] + drift * 0.3f;

  String json;
  json.reserve(230);
  json = "{\"deviceId\":\"";
  json += DEVICE_ID;
  json += "\",\"furnace\":"; json += String(furnace, 1);
  json += ",\"stack\":"; json += String(stack, 1);
  json += ",\"ambient\":"; json += String(ambient, 1);
  json += ",\"humidity\":"; json += String(humidity, 1);
  json += ",\"co\":"; json += String(co, 1);
  json += ",\"h2\":"; json += String(h2, 1);
  json += ",\"voc\":"; json += String(voc, 1);
  json += ",\"smoke\":"; json += String(smoke, 3);
  json += "}";
  return json;
}

unsigned long retryInterval() {
  unsigned long ms = SEND_INTERVAL_MS;
  for (unsigned int i = 1; i < consecutiveHttpFailures && ms < HTTP_BACKOFF_MAX_MS; i++) {
    ms = ms > HTTP_BACKOFF_MAX_MS / 2 ? HTTP_BACKOFF_MAX_MS : ms * 2;
  }
  return ms;
}

void sendTelemetry(unsigned long now) {
  if (WiFi.status() != WL_CONNECTED || permanentConfigError) return;
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  const String body = buildPayload();
  int status = -1;

  if (http.begin(client, SERVER_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + INGEST_KEY);
    status = http.POST(body);
    if (status != 201 && status > 0) {
      Serial.print("[HTTP] Response: ");
      Serial.println(http.getString());
    }
    http.end();
  }

  if (status == 201) {
    ++sentCount;
    consecutiveHttpFailures = 0;
    lastSendAt = millis();
    nextSendAt = lastSendAt + SEND_INTERVAL_MS;
    Serial.printf("[HTTP] 201 OK #%lu, next in 10s: ", sentCount);
    Serial.println(body);
    return;
  }

  ++failedCount;
  if (consecutiveHttpFailures < 8) ++consecutiveHttpFailures;

  // Repeated 401/403 means the device token/configuration needs operator action.
  // Do not endlessly retry invalid credentials.
  if (status == 401 || status == 403) {
    permanentConfigError = true;
    Serial.printf("[HTTP] %d AUTH ERROR: check TELEMETRY_INGEST_KEY. Sending paused until reboot.\n", status);
    return;
  }

  const unsigned long wait = retryInterval();
  nextSendAt = millis() + wait;
  Serial.printf("[HTTP] failed (%d), total failures=%lu, retry in %lu ms\n", status, failedCount, wait);

  // Wi-Fi may show connected even when the connection is stuck.
  // Force reconnection after repeated network failures, without rebooting ESP32.
  if (consecutiveHttpFailures >= WIFI_RECOVER_AFTER_HTTP_FAILURES) {
    Serial.println("[Recovery] Reinitializing Wi-Fi after consecutive HTTP failures.");
    wasConnected = false;
    WiFi.disconnect(false);
    startWiFi();
  }
}

void setup() {
  Serial.begin(115200);
  delay(350);
  Serial.println("\nADI Smart Incinerator - DUMMY TELEMETRY / NOT REAL SENSOR DATA");
  WiFi.persistent(false);
  WiFi.setSleep(false);
  startWiFi();
  nextSendAt = millis() + SEND_INTERVAL_MS;
}

void loop() {
  const unsigned long now = millis();
  maintainWiFi(now);
  // Scheduled using wrap-safe signed difference; no blocking delay in main loop.
  if (WiFi.status() == WL_CONNECTED && !permanentConfigError &&
      (int32_t)(now - nextSendAt) >= 0) {
    sendTelemetry(now);
  }
  delay(10);
}
