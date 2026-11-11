/*
  JR-AIoT / ADI SMART INCINERATOR - EG118 v0.7.4
  Three real RS485 sensors + SoftAP diagnostics + adaptive WORK/WDI + secure telemetry push.\n  CH4 = stack (cerobong), CH5 = furnace (tungku). v0.8.0 ENGINEERING FIELD CANDIDATE; NOT SAFETY CERTIFIED.
  ZEH-first poll order, 250ms device spacing, 45ms inter-byte guard.
  Built from successful v0.7.3.1 serial diagnostic response timing.

  CWT-TH01S  ID3  FC03 register 0x0000 qty2 (RH, ambient temp)
  Ebyte ME31 ID2  FC04 register 0x0190 qty6 (CH4 and CH5)
  Winsen ZEH100 ID1 FC03 register 0x0001 qty4 (CO, H2, VOC, temp, flags)
  RS485: UART1 TX=GPIO32 RX=GPIO33 DE=GPIO12, 9600 8N1.
  WDI/WORK: GPIO3, shared with UART0 RX. DO NOT CONNECT USB-TTL TX
  TO GPIO3/RX0 while running. No Serial.begin(); no serial debug.
  No register writes, relays, or combustion controls. TEST ONLY.
*/
#include <Arduino.h>
#include <WiFi.h>\n#include <WiFiClientSecure.h>\n#include <HTTPClient.h>\n#include <time.h>\n#include "config.h"\n#include "ca_roots.h"
#include <WebServer.h>
#include <esp_timer.h>
#include <driver/gpio.h>
#include "esp_system.h"
#include <math.h>

const char* AP_SSID = "JR-AIoT-DIAG";
const char* AP_PASSWORD = "CHANGE_TO_PRIVATE_AP_PASSWORD";  // REDACTED for public repo; choose a strong secret before flashing
const uint32_t POLL_INTERVAL_MS = 3000;
const uint32_t SEND_INTERVAL_MS = 10000;
const uint32_t WIFI_RETRY_MS = 10000;
const uint32_t HTTP_TIMEOUT_MS = 1800; // blocking network call budget; measure with physical bus
uint32_t lastSendAt = 0, lastWiFiAttemptAt = 0, txOK = 0, txError = 0;
int lastHttpStatus = 0;
bool ntpConfigured = false;
const uint32_t MODBUS_TIMEOUT_MS = 1200; // Increased margin for ZEH100
const uint32_t INTER_SENSOR_MS = 250;
const uint32_t BOOT_SETTLE_MS = 5000;
constexpr int RS485_TX=32, RS485_RX=33, RS485_EN=12, WORK_WDI=3;
constexpr uint8_t ZEH_ID=1, EBYTE_ID=2, CWT_ID=3;

HardwareSerial bus(1);
WebServer server(80);
esp_timer_handle_t heartbeatTimer = nullptr;

// State controls LED/WDI cadence. Pulse is always maintained.
// 0 boot: 100ms high/100ms low; 1 healthy: 100ms high/900ms low;
// 2 degraded: 100ms high/300ms low.
// WDI sees HIGH -> LOW every 0.2/1.0/0.4 seconds respectively.
// Adaptive blink reports status; not a safety-rated watchdog.
// These cadences are an engineering TEST, not independently certified.
volatile uint8_t heartbeatMode=0;
volatile uint8_t hbTicks=0;
volatile bool hbLevel=false;
void heartbeatCallback(void*) {
  const uint8_t mode=heartbeatMode;
  const uint8_t totalTicks=(mode==1)?10:((mode==2)?4:2);
  if (++hbTicks >= totalTicks) hbTicks=0;
  // High for first 100ms, then low; definite falling edge each cycle.
  bool high = (hbTicks==0);
  if (high != hbLevel) {
    hbLevel=high;
    gpio_set_level(static_cast<gpio_num_t>(WORK_WDI), high ? 1 : 0);
  }
}

struct Stats {
  bool online=false;
  uint32_t ok=0;
  uint32_t err=0;
  uint32_t lastOK=0;
};
Stats cwt, ebyte, zeh;
float ambientC=NAN, humidity=NAN, ch4C=NAN, ch5C=NAN, gasModuleC=NAN;
bool ch4Valid=false, ch5Valid=false;
uint16_t coPPM=0, h2PPM=0, vocPPM=0;
uint8_t gasFlags=0;
bool gasDataValid=false;
bool gasWarmupLike=false;
uint32_t gasReadyFrames=0;
uint32_t polls=0, lastPoll=0;
esp_reset_reason_t bootReason;

uint16_t crc16(const uint8_t* b, size_t n) {
  uint16_t crc=0xFFFF;
  for(size_t i=0;i<n;i++) {
    crc^=b[i];
    for(uint8_t bit=0;bit<8;bit++) crc=(crc&1)?(crc>>1)^0xA001:(crc>>1);
  }
  return crc;
}
uint16_t be16(const uint8_t* b) {
  return (uint16_t(b[0])<<8)|b[1];
}
int32_t signed16(uint16_t u) {
  return (u&0x8000)?int32_t(u)-65536:int32_t(u);
}

// Read-only Modbus. Consumes only one response frame, checks CRC, address,
// function, payload size and handles exception frames as failures.
bool readModbus(uint8_t addr,uint8_t fc,uint16_t startReg,uint16_t qty,
                uint8_t* rx,size_t capacity,size_t &rxLen) {
  const size_t expected=5+2*size_t(qty);
  rxLen=0;
  if(expected>capacity || qty==0 || qty>60) return false;

  uint8_t tx[8]={addr,fc,uint8_t(startReg>>8),uint8_t(startReg),
                 uint8_t(qty>>8),uint8_t(qty),0,0};
  uint16_t crc=crc16(tx,6);
  tx[6]=uint8_t(crc); tx[7]=uint8_t(crc>>8);

  while(bus.available()) bus.read();
  digitalWrite(RS485_EN,HIGH);
  delayMicroseconds(300);
  bus.write(tx,8);
  bus.flush();
  delayMicroseconds(500);
  digitalWrite(RS485_EN,LOW);

  uint32_t started=millis(), lastByte=started;
  size_t frameTarget=0;
  while((uint32_t)(millis()-started)<MODBUS_TIMEOUT_MS) {
    while(bus.available()) {
      if(rxLen>=capacity) return false;
      rx[rxLen++]=uint8_t(bus.read());
      lastByte=millis();
      if(rxLen==3) {
        if(rx[1]==uint8_t(fc|0x80)) frameTarget=5;
        else if(rx[1]==fc) frameTarget=5+rx[2];
      }
    }
    if(frameTarget && rxLen>=frameTarget) break;
    if(rxLen && (uint32_t)(millis()-lastByte)>45) break;
    delay(1);
  }

  if(rxLen<5) return false;
  crc=crc16(rx,rxLen-2);
  if(rx[rxLen-2]!=uint8_t(crc) || rx[rxLen-1]!=uint8_t(crc>>8)) return false;
  if(rx[0]!=addr || rx[1]==uint8_t(fc|0x80)) return false;
  return rx[1]==fc && rxLen==expected && rx[2]==qty*2;
}

void readCWT() {
  uint8_t rx[16]={};size_t n=0;
  bool ok=readModbus(CWT_ID,0x03,0x0000,2,rx,sizeof(rx),n);
  if(ok) {
    float h=be16(rx+3)/10.0f;
    float t=signed16(be16(rx+5))/10.0f;
    ok=(h>=0 && h<=100 && t>=-30 && t<=80);
    if(ok) {humidity=h; ambientC=t;}
  }
  cwt.online=ok;
  if(ok) {cwt.ok++;cwt.lastOK=millis();}
  else {cwt.err++;humidity=NAN;ambientC=NAN;}
}

void readEbyte() {
  uint8_t rx[32]={};size_t n=0;
  bool ok=readModbus(EBYTE_ID,0x04,0x0190,6,rx,sizeof(rx),n);
  ebyte.online=ok;
  ch4Valid=false;ch5Valid=false;ch4C=NAN;ch5C=NAN;
  if(ok) {
    for(uint8_t ch=3;ch<=4;ch++) {
      uint16_t raw=be16(rx+3+ch*2);
      float value=signed16(raw)/10.0f;
      bool valid=(raw!=0xFC19 && value>=-200 && value<=1350);
      if(ch==3) {ch4Valid=valid;if(valid) ch4C=value;}
      if(ch==4) {ch5Valid=valid;if(valid) ch5C=value;}
    }
    ebyte.ok++;ebyte.lastOK=millis();
  } else ebyte.err++;
}

void readZEH() {
  uint8_t rx[24]={};size_t n=0;
  bool ok=readModbus(ZEH_ID,0x03,0x0001,4,rx,sizeof(rx),n);
  zeh.online=ok;
  gasDataValid=false;
  gasWarmupLike=false;
  if(ok) {
    zeh.ok++; zeh.lastOK=millis();
    // A CRC-valid frame can still contain an all-zero placeholder during startup.
    bool allZero=true;
    for(uint8_t i=3;i<=10;i++) if(rx[i]!=0) allZero=false;
    if(allZero) {
      gasWarmupLike=true;
      gasReadyFrames=0;
    } else {
      // Do not use a fixed warm-up timer: we have no documented READY flag.
      // Two consecutive non-placeholder frames provide basic stability gating.
      if(gasReadyFrames<2) gasReadyFrames++;
      gasDataValid=(gasReadyFrames>=2);
      coPPM=be16(rx+3);
      h2PPM=be16(rx+5);
      vocPPM=be16(rx+7);
      gasModuleC=int(rx[9])-40;
      gasFlags=rx[10];
    }
  } else {
    zeh.err++;
    gasReadyFrames=0;
  }
  // Availability is tracked separately from the numeric values.
  // UI/JSON only exposes measurements when gasDataValid=true.
}

void updateHeartbeatMode() {
  // Startup, incomplete bus, sensor alarms, or disconnected thermocouple -> faster blink.
  // All 3 devices online, probes valid, no flags -> slow heartbeat.
  const bool healthy=cwt.online && ebyte.online && zeh.online &&
                     ch4Valid && ch5Valid && gasDataValid && gasFlags==0;
  heartbeatMode = healthy ? 1 : 2;
}
String asJSONFloat(float f,int dp=1) {
  return isnan(f) ? "null" : String(f,dp);
}
String asJSONBool(bool b) {return b?"true":"false";}

void handleStatus() {
  String s;
  s.reserve(1150);
  s="{\"firmware\":\"0.8.0\",\"uptime_s\":"+String(millis()/1000UL);
  s+=",\"boot_reason\":"+String(int(bootReason));
  s+=",\"free_heap\":"+String(ESP.getFreeHeap());
  s+=",\"polls\":"+String(polls);
  s+=",\"wifi_sta_connected\":"+asJSONBool(WiFi.status()==WL_CONNECTED);
  s+=",\"http_ok\":"+String(txOK);
  s+=",\"http_errors\":"+String(txError);
  s+=",\"last_http_status\":"+String(lastHttpStatus);
  s+=",\"led_mode\":\""+String(heartbeatMode==1?"NORMAL":heartbeatMode==2?"DEGRADED":"BOOT")+"\"";
  s+=",\"cwt\":{\"id\":3,\"online\":"+asJSONBool(cwt.online);
  s+=",\"temperature_c\":"+asJSONFloat(ambientC);
  s+=",\"humidity_rh\":"+asJSONFloat(humidity);
  s+=",\"ok\":"+String(cwt.ok)+",\"errors\":"+String(cwt.err)+"}";
  s+=",\"ebyte\":{\"id\":2,\"online\":"+asJSONBool(ebyte.online);
  s+=",\"ch4_c\":"+asJSONFloat(ch4C)+",\"ch5_c\":"+asJSONFloat(ch5C);
  s+=",\"ch4_connected\":"+asJSONBool(ch4Valid);
  s+=",\"ch5_connected\":"+asJSONBool(ch5Valid);
  s+=",\"ok\":"+String(ebyte.ok)+",\"errors\":"+String(ebyte.err)+"}";
  s+=",\"zeh100\":{\"id\":1,\"online\":"+asJSONBool(zeh.online);
  s+=",\"data_valid\":"+asJSONBool(gasDataValid);
  s+=",\"warmup_like\":"+asJSONBool(gasWarmupLike);
  s+=",\"co_ppm\":"+(gasDataValid?String(coPPM):"null");
  s+=",\"h2_ppm\":"+(gasDataValid?String(h2PPM):"null");
  s+=",\"voc_ppm\":"+(gasDataValid?String(vocPPM):"null");
  s+=",\"module_c\":"+(gasDataValid?asJSONFloat(gasModuleC,0):"null");
  s+=",\"flags\":"+(gasDataValid?String(gasFlags):"null");
  s+=",\"ok\":"+String(zeh.ok)+",\"errors\":"+String(zeh.err)+"}}";
  server.sendHeader("Cache-Control","no-store");
  server.send(200,"application/json",s);
}

void handleHome() {
  const char page[] PROGMEM=R"HTML(
<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>JR-AIoT | EG118 Triple Sensor</title>
<style>
:root{color-scheme:dark}body{font-family:system-ui,Arial;background:#0e1725;color:#e9f1ff;margin:0;padding:20px}
main{max-width:1000px;margin:auto}header{display:flex;justify-content:space-between;gap:12px;align-items:center}
h1{font-size:23px;margin-bottom:3px}p{color:#9fb0c9;margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}
article{border:1px solid #32445a;border-radius:14px;background:#182639;padding:17px}
small{color:#9fb0c9}strong{font-size:18px}.metric{font-size:20px;margin-top:8px}.good{color:#71e0ae}.bad{color:#ff9a95}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#a9bbd4}
</style></head>
<body><main><header><div><h1>JR-AIoT · Adi Smart Incinerator</h1><p>EG118 v0.7.4 · Triple Sensor · Read-only</p></div><div id="net">Menghubungkan...</div></header>
<section class="grid">
<article><small>SYSTEM</small><div class="metric" id="system">—</div><pre id="sysdetails"></pre></article>
<article><small>CWT TH01S · ID 3</small><div class="metric" id="cwt">—</div><pre id="cwtdetails"></pre></article>
<article><small>EBYTE ME31 · ID 2</small><div class="metric" id="ebyte">—</div><pre id="ebytedetails"></pre></article>
<article><small>WINSEN ZEH100 · ID 1</small><div class="metric" id="zeh">—</div><pre id="zehdetails"></pre></article>
</section><p style="margin-top:16px">Refresh tiap 2 detik. Status Modbus ONLINE tidak berarti termokopel terhubung. Nilai gas OFFLINE atau frame warm-up ditampilkan sebagai N/A, bukan 0 ppm.</p></main>
<script>
function el(id){return document.getElementById(id)}
function f(x,unit=''){return x===null||x===undefined?'N/A':x+unit}
function status(x){return x?'ONLINE':'OFFLINE'}
async function load(){try{
const r=await fetch('/status',{cache:'no-store'});if(!r.ok)throw Error(r.status);
const d=await r.json();el('net').textContent='Wi-Fi Connected';
el('system').textContent=d.uptime_s+' detik';
el('sysdetails').textContent=`Uptime ${d.uptime_s}s\nPolling ${d.polls}\nBoot reason ${d.boot_reason}\nFree heap ${d.free_heap} B\nWORK/WDI ${d.led_mode}`;
el('cwt').textContent=status(d.cwt.online);
el('cwtdetails').textContent=`Suhu lingkungan: ${f(d.cwt.temperature_c,' °C')}\nKelembapan: ${f(d.cwt.humidity_rh,' %RH')}\nOK: ${d.cwt.ok} | Error: ${d.cwt.errors}`;
el('ebyte').textContent=status(d.ebyte.online);
el('ebytedetails').textContent=`CH4: ${f(d.ebyte.ch4_c,' °C')} (${d.ebyte.ch4_connected?'CONNECTED':'DISCONNECTED'})\nCH5: ${f(d.ebyte.ch5_c,' °C')} (${d.ebyte.ch5_connected?'CONNECTED':'DISCONNECTED'})\nOK: ${d.ebyte.ok} | Error: ${d.ebyte.errors}`;
el('zeh').textContent=!d.zeh100.online?'OFFLINE':(d.zeh100.data_valid?'DATA READY':(d.zeh100.warmup_like?'WARM-UP / ZERO FRAME':'WAITING FOR DATA'));
let bits=['CO alarm','H₂ alarm','VOC alarm','Smoke alarm','Temp alarm','CO fault','H₂ fault','VOC fault'];
let alarm=d.zeh100.flags===null?'N/A':(d.zeh100.flags===0?'No alarm/fault':bits.filter((_,i)=>d.zeh100.flags&(1<<i)).join(', '));
el('zehdetails').textContent=`CO: ${f(d.zeh100.co_ppm,' ppm')}\nH₂: ${f(d.zeh100.h2_ppm,' ppm')}\nVOC: ${f(d.zeh100.voc_ppm,' ppm')}\nSuhu modul: ${f(d.zeh100.module_c,' °C')}\nAlarm/fault: ${alarm}\nOK: ${d.zeh100.ok} | Error: ${d.zeh100.errors}`;
}catch(e){el('net').textContent='Disconnected / reboot / Wi-Fi lost'}}
load();setInterval(load,2000);
</script></body></html>
)HTML";
  server.send(200,"text/html; charset=utf-8",FPSTR(page));
}


/*
  Station + telemetry path is intentionally isolated from RS485 acquisition.
  HTTPS: verified CA chain + NTP only. HTTP is limited to private IP LAN testing.
  HTTP is synchronous and may extend a poll cycle by <= HTTP_TIMEOUT_MS;
  heartbeat pulses continue from esp_timer. Validate physical cadence under
  network outages before calling this field-ready.
*/
void connectStation() {
  if (WiFi.status()==WL_CONNECTED) return;
  lastWiFiAttemptAt=millis();
  WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
}
void maintainStation() {
  if (WiFi.status()==WL_CONNECTED) return;
  if ((uint32_t)(millis()-lastWiFiAttemptAt)>=WIFI_RETRY_MS) {
    WiFi.disconnect(false);
    connectStation();
  }
}
bool allowedEndpoint(const String& endpoint,bool& tls) {
  tls=endpoint.startsWith("https://");
  if(tls) return true;
  if(!endpoint.startsWith("http://")) return false;
  String host=endpoint.substring(7);
  int end=host.indexOf('/');
  if(end>=0) host=host.substring(0,end);
  int colon=host.indexOf(':');
  if(colon>=0) host=host.substring(0,colon);
  IPAddress ip;
  if(!ip.fromString(host)) return false;
  return ip[0]==10 || (ip[0]==172 && ip[1]>=16 && ip[1]<=31) ||
         (ip[0]==192 && ip[1]==168);
}
String buildTelemetryJSON() {
  String s; s.reserve(650);
  s="{\"deviceId\":\"ADI-EG118-01\"";
  // CH4 is stack and CH5 is furnace; confirmed by project owner.
  s+=",\"stack\":"+asJSONFloat(ch4C);
  s+=",\"furnace\":"+asJSONFloat(ch5C);
  s+=",\"ambient\":"+asJSONFloat(ambientC);
  s+=",\"humidity\":"+asJSONFloat(humidity);
  s+=",\"co\":"+(gasDataValid?String(coPPM):"null");
  s+=",\"h2\":"+(gasDataValid?String(h2PPM):"null");
  s+=",\"voc\":"+(gasDataValid?String(vocPPM):"null");
  s+=",\"smoke\":null"; // ZEH smoke alarm bit is NOT a numeric measurement.
  s+=",\"gasModuleC\":"+(gasDataValid?asJSONFloat(gasModuleC,0):"null");
  s+=",\"sensors\":{\"cwt\":{\"online\":"+asJSONBool(cwt.online);
  s+=",\"errors\":"+String(cwt.err)+"}";
  s+=",\"ebyte\":{\"online\":"+asJSONBool(ebyte.online);
  s+=",\"ch4Connected\":"+asJSONBool(ch4Valid);
  s+=",\"ch5Connected\":"+asJSONBool(ch5Valid);
  s+=",\"errors\":"+String(ebyte.err)+"}";
  s+=",\"zeh100\":{\"online\":"+asJSONBool(zeh.online);
  s+=",\"dataValid\":"+asJSONBool(gasDataValid);
  s+=",\"warmupLike\":"+asJSONBool(gasWarmupLike);
  s+=",\"flags\":"+(gasDataValid?String(gasFlags):"null");
  s+=",\"errors\":"+String(zeh.err)+"}}}";
  return s;
}
void pushTelemetry() {
  if(WiFi.status()!=WL_CONNECTED || strlen(TELEMETRY_INGEST_KEY)<24) return;
  String url=String(TELEMETRY_URL);
  bool tls=false;
  if(!allowedEndpoint(url,tls)) {lastHttpStatus=-100; txError++; return;}
  if(tls) {
    if(!ntpConfigured) {
      configTime(0,0,"pool.ntp.org","time.google.com");
      ntpConfigured=true;
    }
    if(time(nullptr)<1700000000) {lastHttpStatus=-101; txError++; return;}
  }
  WiFiClient plain;
  WiFiClientSecure secure;
  if(tls) secure.setCACert(ADI_TRUSTED_CA_ROOTS);
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  bool opened=tls ? http.begin(secure,url) : http.begin(plain,url);
  if(!opened) {lastHttpStatus=-102; txError++; return;}
  http.addHeader("Content-Type","application/json");
  http.addHeader("Authorization",String("Bearer ")+TELEMETRY_INGEST_KEY);
  http.addHeader("Cache-Control","no-store");
  String payload=buildTelemetryJSON();
  lastHttpStatus=http.POST(payload);
  http.end();
  if(lastHttpStatus==201) txOK++;
  else txError++;
}

void setup() {
  // GPIO3 is UART0 RX and watchdog input: no Serial.begin()!
  bootReason=esp_reset_reason();
  pinMode(RS485_EN,OUTPUT);
  digitalWrite(RS485_EN,LOW);
  bus.begin(9600,SERIAL_8N1,RS485_RX,RS485_TX);

  gpio_set_direction(static_cast<gpio_num_t>(WORK_WDI),GPIO_MODE_OUTPUT);
  gpio_set_level(static_cast<gpio_num_t>(WORK_WDI),0);
  hbLevel=false; hbTicks=0; heartbeatMode=0;
  esp_timer_create_args_t args={};
  args.callback=&heartbeatCallback;
  args.arg=nullptr;
  args.dispatch_method=ESP_TIMER_TASK;
  args.name="EG118_WDI";
  if(esp_timer_create(&args,&heartbeatTimer)==ESP_OK) {
    esp_timer_start_periodic(heartbeatTimer,100000); // 100ms timer ticks
  }

  WiFi.mode(WIFI_AP_STA);\n  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.softAP(AP_SSID,AP_PASSWORD,1,0,2);\n  connectStation();
  server.on("/",HTTP_GET,handleHome);
  server.on("/status",HTTP_GET,handleStatus);
  server.begin();
  uint32_t started=millis();
  while((uint32_t)(millis()-started)<BOOT_SETTLE_MS) {
    server.handleClient();
    delay(2);
  }
  lastPoll=millis()-POLL_INTERVAL_MS;
}

void loop() {
  server.handleClient();
  if((uint32_t)(millis()-lastPoll)>=POLL_INTERVAL_MS) {
    lastPoll=millis();
    ++polls;
    readZEH();
    delay(INTER_SENSOR_MS);
    readCWT();
    delay(INTER_SENSOR_MS);
    readEbyte();
    updateHeartbeatMode();\n    if (WiFi.status()==WL_CONNECTED && (uint32_t)(millis()-lastSendAt)>=SEND_INTERVAL_MS) {\n      lastSendAt=millis();\n      pushTelemetry();\n    }
  }
  delay(1);
}