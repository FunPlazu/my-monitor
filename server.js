const express = require('express');
const fetch = require('node-fetch').default;

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// ВСТРОЕННАЯ HTML-СТРАНИЦА С КАРТОЙ (полная)
// ============================================================
const HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Мониторинг датчиков почвы</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f0f2f5; }
    #map { height:100vh; width:100%; background:#e5e9f0; }

  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    const API_URL = '/api/sensors/all';
    const REFRESH_INTERVAL = 60000;

    const map = L.map('map', { center: [22,80], zoom:5, minZoom:4, maxZoom:12 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);

    let sensorsData = [];
    const markers = {};
    const geoCache = {};

    async function fetchLocation(lat, lng) {
      const key = \`\${lat.toFixed(2)}_\${lng.toFixed(2)}\`;
      if (geoCache[key]) return geoCache[key];
      try {
        const resp = await fetch(\`https://nominatim.openstreetmap.org/reverse?lat=\${lat}&lon=\${lng}&format=json&zoom=10&accept-language=ru\`, {
          headers: { 'User-Agent': 'SensorMap/1.0' }
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const addr = data.address;
        const loc = addr?.city || addr?.town || addr?.village || addr?.hamlet || addr?.municipality || addr?.county || null;
        geoCache[key] = loc;
        return loc;
      } catch { return null; }
    }

    function extractSensorsArray(data) {
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') {
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.sensors)) return data.sensors;
        if (Array.isArray(data.items)) return data.items;
        if (data.id && data.lat !== undefined) return [data];
      }
      return null;
    }

    function normalizeSensors(sensors) {
      return sensors.map(s => ({
        id: s.id || s.sensor_id || s.device_id || String(Math.random()),
        name: s.name || s.label || s.location || 'Датчик',
        lat: parseFloat(s.lat || s.latitude || 0),
        lng: parseFloat(s.lng || s.lon || s.longitude || 0),
        temperature: parseFloat(s.temperature || s.temp || s.value || 0),
        humidity: s.humidity !== null && s.humidity !== undefined ? parseFloat(s.humidity) : null,
        sensorType: s.sensorType || 'soil',
        timestamp: parseInt(s.timestamp || s.time || s.ts || Date.now())
      })).filter(s => !isNaN(s.lat) && !isNaN(s.lng) && s.lat !== 0 && s.lng !== 0);
    }

    async function fetchSensors() {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
        const rawData = await response.json();
        let sensors = extractSensorsArray(rawData);
        if (!sensors || !Array.isArray(sensors) || sensors.length === 0) throw new Error('Пустой ответ');
        sensors = normalizeSensors(sensors);
        if (sensors.length === 0) throw new Error('Нет корректных датчиков');
        sensors.forEach(s => {
          const key = \`\${s.lat.toFixed(2)}_\${s.lng.toFixed(2)}\`;
          if (geoCache[key]) s.location = geoCache[key];
        });
        sensorsData = sensors;
        updateMap(sensorsData);
        sensors.forEach(s => {
          const key = \`\${s.lat.toFixed(2)}_\${s.lng.toFixed(2)}\`;
          if (!geoCache[key]) {
            fetchLocation(s.lat, s.lng).then(loc => {
              s.location = loc;
              if (loc && markers[s.id]) {
                const popup = markers[s.id].getPopup();
                if (popup) {
                  const old = popup.getContent();
                  markers[s.id].setPopupContent(old.replace('📍', \`🏘️ \${loc}<br>📍\`));
                }
              }
            });
          }
        });
      } catch (err) {
        console.error('❌ Ошибка:', err);
        sensorsData = [];
        updateMap([]);
      }
    }

    function updateMap(sensors) {
      const newIds = new Set(sensors.map(s => s.id));
      for (const id in markers) if (!newIds.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
      sensors.forEach(sensor => {
        const { id, lat, lng, temperature, humidity, name, timestamp, sensorType } = sensor;
        const isAir = sensorType === 'air';
        let color;
        if (temperature > 0) {
          const warmRatio = Math.min(1, temperature / 50);
          const hue = 120 - warmRatio * 120;
          color = \`hsl(\${hue}, 80%, 60%)\`;
        } else if (temperature > -20) {
          color = '#AED6F1';
        } else if (temperature > -50) {
          color = '#5DADE2';
        } else if (temperature > -100) {
          color = '#2E86C1';
        } else if (temperature > -150) {
          color = '#1B4F72';
        } else if (temperature > -200) {
          color = '#0E2C4A';
        } else if (temperature > -250) {
          color = '#071526';
        } else {
          color = '#000000';
        }
        const typeLabel = isAir ? '💨 Воздух' : '🌱 Почва';
        let popupContent = \`<b>\${name || 'Датчик '+id}</b><br>\${typeLabel}<br>🌡️ \${temperature.toFixed(1)} °C\`;
        if (humidity !== null && humidity !== undefined) popupContent += \`<br>💧 Влажность: \${humidity.toFixed(1)}%\`;
        if (sensor.location) popupContent += \`<br>🏘️ \${sensor.location}\`;
        popupContent += \`<br>📍 \${lat.toFixed(4)}, \${lng.toFixed(4)}\`;
        popupContent += \`<br>🕒 \${new Date(timestamp).toLocaleString()}\`;
        const icon = L.divIcon({
          className: 'custom-div-icon',
          html: \`<div style="background-color:\${color}; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.7);"></div>\`,
          iconSize: [16,16], iconAnchor: [8,8]
        });
        if (markers[id]) {
          markers[id].setPopupContent(popupContent);
          markers[id].setIcon(icon);
        } else {
          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.bindPopup(popupContent);
          markers[id] = marker;
        }
      });
    }

    fetchSensors();
    setInterval(fetchSensors, REFRESH_INTERVAL);
  </script>
</body>
</html>
`;

// ============================================================
// ОСНОВНОЙ СЕРВЕР
// ============================================================
app.get('/', (req, res) => res.send(HTML));

// Комбинированный эндпоинт: почва + воздух вместе
app.get('/api/sensors/all', async (req, res) => {
  try {
    const fetchType = async (type, paramKey) => {
      const listRes = await fetch(`http://nimph.fial-corporation.ru/api/v1/sensors?type=${type}`, {
        headers: { 'accept': 'application/json' }
      });
      if (!listRes.ok) return [];
      const listData = await listRes.json();
      const sensorsList = listData.data || listData.sensors || listData;
      if (!Array.isArray(sensorsList)) return [];

      const results = await Promise.all(
        sensorsList.map(async (sensor) => {
          const sensorId = sensor.sensor_id || sensor.id;
          if (!sensorId) return null;
          try {
            const readingRes = await fetch(`http://nimph.fial-corporation.ru/api/v1/sensors/${sensorId}/readings`, {
              headers: { 'accept': 'application/json' }
            });
            if (!readingRes.ok) return null;
            const data = await readingRes.json();
            const sensorData = data.sensor || data;
            const temp = sensorData.parameters?.[paramKey]?.value ?? sensorData.temperature ?? sensorData.temp ?? null;
            if (temp === null) return null;
            const humidity = sensorData.parameters?.humidity?.value ?? null;
            return {
              id: `${type}_${sensorId}`,
              name: sensor.name || sensor.label || `Датчик ${sensorId}`,
              lat: parseFloat(sensor.lat || sensor.latitude || 0),
              lng: parseFloat(sensor.lng || sensor.longitude || 0),
              temperature: parseFloat(temp),
              humidity: humidity !== null ? parseFloat(humidity) : null,
              sensorType: type,
              timestamp: Date.now()
            };
          } catch { return null; }
        })
      );
      return results.filter(s => s !== null);
    };

    const [soil, air] = await Promise.all([
      fetchType('soil', 'soil_temp'),
      fetchType('air', 'air_temp')
    ]);

    const all = [...soil, ...air];
    console.log(`✅ Всего загружено ${all.length} датчиков (почва: ${soil.length}, воздух: ${air.length})`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.json(all);
  } catch (err) {
    console.error('❌ Критическая ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Агрегирующий эндпоинт: получает список датчиков, потом для каждого получает температуру
app.get('/api/sensors', async (req, res) => {
  try {
    // 1. Получаем список датчиков
    const listRes = await fetch('http://nimph.fial-corporation.ru/api/v1/sensors?type=soil', {
      headers: { 'accept': 'application/json' }
    });
    if (!listRes.ok) {
      const txt = await listRes.text();
      throw new Error(`Ошибка списка ${listRes.status}: ${txt.slice(0, 100)}`);
    }
    const listData = await listRes.json();
    const sensorsList = listData.data || listData.sensors || listData;
    if (!Array.isArray(sensorsList)) throw new Error('Неверный формат списка датчиков');
    console.log(`📦 Получено ${sensorsList.length} датчиков`);

    // 2. Для каждого датчика получаем текущую температуру
    const sensorsWithTemp = await Promise.all(
      sensorsList.map(async (sensor) => {
        const sensorId = sensor.sensor_id || sensor.id;
        if (!sensorId) return null;
        try {
          const readingUrl = `http://nimph.fial-corporation.ru/api/v1/sensors/${sensorId}/readings`;
          const readingRes = await fetch(readingUrl, {
            headers: { 'accept': 'application/json' }
          });
          if (!readingRes.ok) {
            console.warn(`⚠️ Нет данных для ${sensor.sensor_id || sensor.id} (${readingRes.status})`);
            return null;
          }
          const data = await readingRes.json();
          const sensorData = data.sensor || data;
          const temp = sensorData.parameters?.soil_temp?.value ?? sensorData.temperature ?? sensorData.temp ?? null;
          if (temp === null) return null;
          return {
            id: sensorId,
            name: sensor.name || sensor.label || `Датчик ${sensorId}`,
            lat: parseFloat(sensor.lat || sensor.latitude || 0),
            lng: parseFloat(sensor.lng || sensor.longitude || 0),
            temperature: parseFloat(temp),
            timestamp: Date.now()
          };
        } catch (e) {
          console.warn(`❌ Ошибка запроса для ${sensorId}:`, e.message);
          return null;
        }
      })
    );

    const valid = sensorsWithTemp.filter(s => s !== null);
    console.log(`✅ Успешно загружено ${valid.length} датчиков с температурой`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.json(valid);
  } catch (err) {
    console.error('❌ Критическая ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Агрегирующий эндпоинт для датчиков воздуха
app.get('/api/sensors/air', async (req, res) => {
  try {
    const listRes = await fetch('http://nimph.fial-corporation.ru/api/v1/sensors?type=air', {
      headers: { 'accept': 'application/json' }
    });
    if (!listRes.ok) {
      const txt = await listRes.text();
      throw new Error(`Ошибка списка ${listRes.status}: ${txt.slice(0, 100)}`);
    }
    const listData = await listRes.json();
    const sensorsList = listData.data || listData.sensors || listData;
    if (!Array.isArray(sensorsList)) throw new Error('Неверный формат списка датчиков');
    console.log(`📦 Получено ${sensorsList.length} датчиков воздуха`);

    const sensorsWithData = await Promise.all(
      sensorsList.map(async (sensor) => {
        const sensorId = sensor.sensor_id || sensor.id;
        if (!sensorId) return null;
        try {
          const readingUrl = `http://nimph.fial-corporation.ru/api/v1/sensors/${sensorId}/readings`;
          const readingRes = await fetch(readingUrl, {
            headers: { 'accept': 'application/json' }
          });
          if (!readingRes.ok) {
            console.warn(`⚠️ Нет данных для ${sensor.sensor_id || sensor.id} (${readingRes.status})`);
            return null;
          }
          const data = await readingRes.json();
          const sensorData = data.sensor || data;
          const temp = sensorData.parameters?.air_temp?.value ?? sensorData.temperature ?? sensorData.temp ?? null;
          const humidity = sensorData.parameters?.humidity?.value ?? null;
          if (temp === null) return null;
          return {
            id: sensorId,
            name: sensor.name || sensor.label || `Датчик ${sensorId}`,
            lat: parseFloat(sensor.lat || sensor.latitude || 0),
            lng: parseFloat(sensor.lng || sensor.longitude || 0),
            temperature: parseFloat(temp),
            humidity: humidity !== null ? parseFloat(humidity) : null,
            timestamp: Date.now()
          };
        } catch (e) {
          console.warn(`❌ Ошибка запроса для ${sensorId}:`, e.message);
          return null;
        }
      })
    );

    const valid = sensorsWithData.filter(s => s !== null);
    console.log(`✅ Успешно загружено ${valid.length} датчиков воздуха с температурой`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.json(valid);
  } catch (err) {
    console.error('❌ Критическая ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
  console.log(`📡 Данные агрегируются с http://nimph.fial-corporation.ru/api/v1/sensors?type=soil`);
  console.log(`📡 Данные агрегируются с http://nimph.fial-corporation.ru/api/v1/sensors?type=air`);
});