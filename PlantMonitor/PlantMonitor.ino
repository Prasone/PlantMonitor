#include <WiFi.h>
#include <HTTPClient.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include "DHT.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// --- Konfigurasi WiFi ---
const char* ssid = "faiz";
const char* password = "arshaka18";

// --- Konfigurasi ThingSpeak ---
String apiKey = ".";  // write API
const char* serverTS = "http://api.thingspeak.com/update";

// --- Konfigurasi Sensor ---
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);
#define SOIL_PIN 34  // ADC input soil sensor

// --- Relay Pin ---
#define RELAY_PUMP 12
#define RELAY_FAN 13

// --- Web Server & Status ---
AsyncWebServer server(80);
float temperature = 28.4, humidity = 64.0;
int soilPercent = 72;
bool autoMode = true; // Mode Otomatis / Manual Override

// Timer Quick Water
unsigned long quickWaterEndTime = 0;

// Timing non-blocking
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL = 2000;  // baca sensor + update LCD tiap 2 detik
unsigned long lastThingSpeak = 0;
const unsigned long THINGSPEAK_INTERVAL = 20000;  // kirim ThingSpeak tiap 20 detik

// LCD I2C
LiquidCrystal_I2C lcd(0x27, 20, 4);

void updateLCD() {
  lcd.setCursor(7, 1);
  lcd.print("      ");
  lcd.setCursor(7, 1);
  lcd.print(temperature, 1);
  lcd.print((char)223);
  lcd.print("C");

  lcd.setCursor(9, 2);
  lcd.print("      ");
  lcd.setCursor(9, 2);
  lcd.print(humidity, 1);
  lcd.print("%");

  lcd.setCursor(9, 3);
  lcd.print("      ");
  lcd.setCursor(9, 3);
  lcd.print(soilPercent);
  lcd.print("%");
}

// Dynamic Threshold Auto-Control (Dapat diubah secara realtime via Web Interface)
int soilThreshold = 60;       // Kelembapan tanah < 60% -> Pompa ON
float tempThreshold = 28.0;   // Temperatur > 28.0°C -> Fan ON (Pendinginan)

void autoControlRelay() {
  // Jika sedang siram cepat (timer aktif)
  if (millis() < quickWaterEndTime) {
    digitalWrite(RELAY_PUMP, HIGH);
  } else if (autoMode) { // Mode Otomatis Aktif
    // Pompa menyala jika kelembapan tanah di bawah threshold (tanah kering)
    bool pumpNeeded = (soilPercent < soilThreshold);
    digitalWrite(RELAY_PUMP, pumpNeeded ? HIGH : LOW);

    // Kipas menyala jika temperatur di atas threshold (ruangan panas)
    bool fanNeeded = (temperature > tempThreshold);
    digitalWrite(RELAY_FAN, fanNeeded ? HIGH : LOW);
  }
}

void sendThingSpeak() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(serverTS) + "?api_key=" + apiKey +
               "&field1=" + String(temperature) +
               "&field2=" + String(humidity) +
               "&field3=" + String(soilPercent);
  http.begin(url);
  int httpCode = http.GET();
  if (httpCode > 0) {
    Serial.println("ThingSpeak update OK");
  } else {
    Serial.println("Gagal kirim ke ThingSpeak");
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  randomSeed(micros());

  lcd.begin();
  lcd.backlight();
  lcd.setCursor(5, 0); lcd.print("Monitoring");
  lcd.setCursor(0, 1); lcd.print("Suhu : ");
  lcd.setCursor(0, 2); lcd.print("K.Udara: ");
  lcd.setCursor(0, 3); lcd.print("K.Tanah: ");

  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount gagal!");
    return;
  }
  Serial.println("LittleFS mounted.");

  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan WiFi...");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {
    delay(300);
    Serial.print(".");
  }

  pinMode(RELAY_PUMP, OUTPUT);
  pinMode(RELAY_FAN, OUTPUT);
  digitalWrite(RELAY_PUMP, LOW);
  digitalWrite(RELAY_FAN, LOW);

  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // Endpoint Telemetri Data
  server.on("/data", HTTP_GET, [](AsyncWebServerRequest* request) {
    String json = "{";
    json += "\"temperature\":" + String(temperature, 1) + ",";
    json += "\"humidity\":" + String(humidity, 1) + ",";
    json += "\"soil\":" + String(soilPercent) + ",";
    json += "\"pumpState\":" + String(digitalRead(RELAY_PUMP) == HIGH ? "true" : "false") + ",";
    json += "\"fanState\":" + String(digitalRead(RELAY_FAN) == HIGH ? "true" : "false") + ",";
    json += "\"autoMode\":" + String(autoMode ? "true" : "false") + ",";
    json += "\"soilThreshold\":" + String(soilThreshold) + ",";
    json += "\"tempThreshold\":" + String(tempThreshold, 1);
    json += "}";
    request->send(200, "application/json", json);
  });

  // Endpoint Update Config Threshold
  server.on("/config", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("soil")) {
      soilThreshold = request->getParam("soil")->value().toInt();
    }
    if (request->hasParam("temp")) {
      tempThreshold = request->getParam("temp")->value().toFloat();
    }
    String json = "{";
    json += "\"status\":\"ok\",";
    json += "\"soilThreshold\":" + String(soilThreshold) + ",";
    json += "\"tempThreshold\":" + String(tempThreshold, 1);
    json += "}";
    request->send(200, "application/json", json);
  });

  // Endpoint Auto Mode Switch
  server.on("/auto", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();
      autoMode = (state == "1");
      request->send(200, "text/plain", autoMode ? "Auto ON" : "Auto OFF");
    } else {
      request->send(400, "text/plain", "Bad Request");
    }
  });

  // Endpoint Kontrol Pompa
  server.on("/pump", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();
      bool turnOn = (state == "1");

      if (request->hasParam("duration")) {
        int sec = request->getParam("duration")->value().toInt();
        quickWaterEndTime = millis() + (sec * 1000);
        digitalWrite(RELAY_PUMP, HIGH);
      } else {
        quickWaterEndTime = 0; // reset quick water
        digitalWrite(RELAY_PUMP, turnOn ? HIGH : LOW);
      }
      request->send(200, "text/plain", turnOn ? "Pump ON" : "Pump OFF");
    } else {
      request->send(400, "text/plain", "Bad Request");
    }
  });

  // Endpoint Kontrol Kipas
  server.on("/fan", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();
      digitalWrite(RELAY_FAN, state == "1" ? HIGH : LOW);
      request->send(200, "text/plain", state == "1" ? "Fan ON" : "Fan OFF");
    } else {
      request->send(400, "text/plain", "Bad Request");
    }
  });

  server.begin();
}

void loop() {
  unsigned long now = millis();

  // Baca Sensor & Update LCD tiap 2 detik
  if (now - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = now;

    // Baca sensor DHT22
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) temperature = t;
    if (!isnan(h)) humidity = h;

    // Baca sensor Kelembapan Tanah (ADC Pin 34: 0-4095 ke 0-100%)
    // int rawSoil = analogRead(SOIL_PIN);
    // soilPercent = map(rawSoil, 4095, 1500, 0, 100);
    // soilPercent = constrain(soilPercent, 0, 100);
    soilPercent = 54;

    updateLCD();
  }

  // Kontrol Otomatis Relay Pompa & Kipas secara kontinyu
  autoControlRelay();

  // Kirim ke ThingSpeak tiap 20 detik
  if (now - lastThingSpeak >= THINGSPEAK_INTERVAL) {
    lastThingSpeak = now;
    sendThingSpeak();
  }
}