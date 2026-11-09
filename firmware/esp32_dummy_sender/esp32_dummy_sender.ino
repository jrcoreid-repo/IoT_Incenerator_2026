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

constexpr unsigned long SEND_INTERVAL_MS = 3000;
constexpr unsigned long WIFI_RETRY_MS = 8000;
unsigned long lastSendAt = 0;
unsigned long lastReconnectAt = 0;
unsigned long sentCount = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  for (int i = 0; i < 25 && WiFi.status() != WL_CONNECTED; i++) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("ESP IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Target: ");
    Serial.println(SERVER_URL);
  } else {
    Serial.println("Wi-Fi not connected, retrying later");
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

void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(4500);

  if (!http.begin(client, SERVER_URL)) {
    Serial.println("HTTP begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_KEY);

  const String body = buildPayload();
  const int status = http.POST(body);
  Serial.print("Send #");
  Serial.print(++sentCount);
  Serial.print(" HTTP ");
  Serial.print(status);
  Serial.print(" JSON: ");
  Serial.println(body);
  if (status != 201) {
    Serial.print("Response: ");
    Serial.println(http.getString());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nADI Smart Incinerator - DUMMY TELEMETRY / NOT REAL SENSOR DATA");
  connectWiFi();
  lastSendAt = millis();
}

void loop() {
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastReconnectAt >= WIFI_RETRY_MS) {
      lastReconnectAt = now;
      connectWiFi();
    }
    return;
  }

  if (now - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = now;
    sendTelemetry();
  }
}
