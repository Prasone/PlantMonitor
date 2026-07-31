(function() {
  "use strict";

  const REFRESH_MS = 2000;
  const togglePump = document.getElementById('togglePump');
  const toggleFan = document.getElementById('toggleFan');
  const toggleAuto = document.getElementById('toggleAuto');
  const pumpBadge = document.getElementById('pumpBadge');
  const fanBadge = document.getElementById('fanBadge');
  const modeLabel = document.getElementById('modeLabel');

  const chartAvgTemp = document.getElementById('chartAvgTemp');
  const chartAvgHum = document.getElementById('chartAvgHum');
  const chartAvgSoil = document.getElementById('chartAvgSoil');

  let activeFilter = 'all';
  let isLive = true;

  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', function() {
      filterPills.forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      activeFilter = this.getAttribute('data-filter');
      renderChart();
    });
  });

  const btnLiveToggle = document.getElementById('btnLiveToggle');
  if (btnLiveToggle) {
    btnLiveToggle.addEventListener('click', function() {
      isLive = !isLive;
      if (isLive) {
        this.innerHTML = '<span class="pause-icon">||</span> LIVE';
        this.style.background = 'rgba(34, 197, 94, 0.12)';
        this.style.color = '#4ade80';
      } else {
        this.innerHTML = '<span class="pause-icon">▶</span> PAUSED';
        this.style.background = 'rgba(239, 68, 68, 0.15)';
        this.style.color = '#f87171';
      }
    });
  }

  const history = [];
  const MAX_POINTS = 10;

  window.quickWater = async function(seconds) {
    if (togglePump) togglePump.checked = true;
    if (pumpBadge) {
      pumpBadge.textContent = 'STATUS: AKTIF (' + seconds + 's)';
      pumpBadge.className = 'device-badge badge-active';
    }
    try {
      await fetch('/pump?state=1&duration=' + seconds);
    } catch (e) {
      console.error('Error quick watering:', e);
    }
  };

  const canvas = document.getElementById('realtimeChart');
  const ctx = canvas ? canvas.getContext('2d') : null;

  function renderChart() {
    if (!ctx || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 40;
    const paddingBottom = 30;
    const paddingTop = 15;
    const paddingRight = 15;

    const chartW = width - paddingLeft - paddingRight;
    const chartH = height - paddingTop - paddingBottom;

    const yTicks = [0, 25, 50, 75, 100];
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '10px monospace';
    ctx.fillStyle = '#64748b';

    yTicks.forEach(tickVal => {
      const normY = (tickVal - 0) / 100;
      const y = paddingTop + chartH - (normY * chartH);

      ctx.fillText(tickVal.toString(), paddingLeft - 10, y);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if (history.length === 0) return;

    const stepX = history.length > 1 ? chartW / (MAX_POINTS - 1) : 0;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '9px monospace';
    ctx.fillStyle = '#64748b';

    history.forEach((pt, i) => {
      const x = paddingLeft + (i * stepX);
      ctx.fillText(pt.time, x, paddingTop + chartH + 8);
    });

    if (history.length < 2) return;

    function drawSeries(key, color, minY = 0, maxY = 100) {
      ctx.beginPath();
      history.forEach((pt, i) => {
        const val = pt[key];
        const x = paddingLeft + (i * stepX);
        const normY = Math.max(0, Math.min(1, (val - minY) / (maxY - minY)));
        const y = paddingTop + chartH - (normY * chartH);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      history.forEach((pt, i) => {
        const val = pt[key];
        const x = paddingLeft + (i * stepX);
        const normY = Math.max(0, Math.min(1, (val - minY) / (maxY - minY)));
        const y = paddingTop + chartH - (normY * chartH);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#07090d';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (activeFilter === 'all' || activeFilter === 'soil') {
      drawSeries('soil', '#22c55e', 0, 100);
    }
    if (activeFilter === 'all' || activeFilter === 'hum') {
      drawSeries('hum', '#3b82f6', 0, 100);
    }
    if (activeFilter === 'all' || activeFilter === 'temp') {
      drawSeries('temp', '#f59e0b', 0, 100);
    }
  }

  function updateAverages() {
    if (history.length === 0) return;
    const sumTemp = history.reduce((acc, curr) => acc + curr.temp, 0);
    const sumHum = history.reduce((acc, curr) => acc + curr.hum, 0);
    const sumSoil = history.reduce((acc, curr) => acc + curr.soil, 0);

    const avgT = (sumTemp / history.length).toFixed(1);
    const avgH = (sumHum / history.length).toFixed(1);
    const avgS = Math.round(sumSoil / history.length);

    if (chartAvgTemp) chartAvgTemp.textContent = avgT + '°C';
    if (chartAvgHum) chartAvgHum.textContent = avgH + '%';
    if (chartAvgSoil) chartAvgSoil.textContent = avgS + '%';
  }

  async function pollData() {
    if (!isLive) return;

    try {
      const res = await fetch('/data');
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();

      const temp = Number(data.temperature) || 28.4;
      const hum = Number(data.humidity) || 64.0;
      const soil = Number(data.soil) || 72;

      document.getElementById('valTemp').textContent = temp.toFixed(1);
      document.getElementById('valHum').textContent = hum.toFixed(1);
      document.getElementById('valSoil').textContent = Math.round(soil);

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });

      history.push({ temp, hum, soil, time: timeStr });
      if (history.length > MAX_POINTS) history.shift();

      updateAverages();
      renderChart();

      const pumpPanel = document.getElementById('pumpPanel');
      const fanPanel = document.getElementById('fanPanel');
      const pumpCardState = document.getElementById('pumpCardState');
      const pumpDot = document.getElementById('pumpDot');
      const fanCardState = document.getElementById('fanCardState');
      const fanDot = document.getElementById('fanDot');

      const isAuto = typeof data.autoMode !== 'undefined' ? Boolean(data.autoMode) : true;

      if (toggleAuto) {
        toggleAuto.checked = isAuto;
        if (modeLabel) {
          modeLabel.textContent = isAuto ? 'KONTROL OTOMATIS' : 'MANUAL OVERRIDE';
        }
      }

      if (togglePump && typeof data.pumpState !== 'undefined') {
        const isPumpOn = Boolean(data.pumpState);
        togglePump.checked = isPumpOn;

        if (pumpBadge) {
          if (isPumpOn) {
            pumpBadge.textContent = isAuto ? 'STATUS: AKTIF (OTOMATIS)' : 'STATUS: AKTIF (MANUAL)';
            pumpBadge.className = 'device-badge badge-active';
          } else {
            pumpBadge.textContent = 'STATUS: OFF';
            pumpBadge.className = 'device-badge badge-off';
          }
        }

        if (pumpPanel) {
          if (isPumpOn) pumpPanel.classList.add('panel-active-pump');
          else pumpPanel.classList.remove('panel-active-pump');
        }

        if (pumpCardState) {
          pumpCardState.textContent = isPumpOn ? 'AKTIF 💧' : 'OFF';
          pumpCardState.style.color = isPumpOn ? '#22c55e' : 'var(--text-dim)';
        }
        if (pumpDot) {
          pumpDot.className = isPumpOn ? 'dot-active-green' : 'dot-off';
        }
      }

      if (toggleFan && typeof data.fanState !== 'undefined') {
        const isFanOn = Boolean(data.fanState);
        toggleFan.checked = isFanOn;

        if (fanBadge) {
          if (isFanOn) {
            fanBadge.textContent = isAuto ? 'STATUS: AKTIF (OTOMATIS)' : 'STATUS: AKTIF (MANUAL)';
            fanBadge.className = 'device-badge badge-active-amber';
          } else {
            fanBadge.textContent = 'STATUS: OFF';
            fanBadge.className = 'device-badge badge-off';
          }
        }

        if (fanPanel) {
          if (isFanOn) fanPanel.classList.add('panel-active-fan');
          else fanPanel.classList.remove('panel-active-fan');
        }

        if (fanCardState) {
          fanCardState.textContent = isFanOn ? 'AKTIF 🌀' : 'OFF';
          fanCardState.style.color = isFanOn ? '#f59e0b' : 'var(--text-dim)';
        }
        if (fanDot) {
          fanDot.className = isFanOn ? 'dot-active-amber' : 'dot-off';
        }
      }

      // Update Threshold Displays if provided by ESP32
      const soilValDisp = document.getElementById('soilValDisp');
      const tempValDisp = document.getElementById('tempValDisp');
      const inputSoilThresh = document.getElementById('inputSoilThresh');
      const inputTempThresh = document.getElementById('inputTempThresh');

      if (typeof data.soilThreshold !== 'undefined') {
        if (soilValDisp) soilValDisp.textContent = data.soilThreshold;
        if (inputSoilThresh && document.activeElement !== inputSoilThresh) {
          inputSoilThresh.value = data.soilThreshold;
        }
      }
      if (typeof data.tempThreshold !== 'undefined') {
        if (tempValDisp) tempValDisp.textContent = Number(data.tempThreshold).toFixed(1);
        if (inputTempThresh && document.activeElement !== inputTempThresh) {
          inputTempThresh.value = Number(data.tempThreshold).toFixed(1);
        }
      }

      document.getElementById('connText').textContent = 'ESP32 Connected';
    } catch (err) {
      document.getElementById('connText').textContent = 'Connecting...';
    }
  }

  const baseTime = new Date();
  for (let i = MAX_POINTS - 1; i >= 0; i--) {
    const t = new Date(baseTime.getTime() - i * 2000);
    const timeStr = t.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    history.push({
      temp: 26.5 + (Math.sin(i) * 0.4),
      hum: 64.4 + (Math.cos(i) * 0.5),
      soil: 51 + Math.round(Math.sin(i * 0.5) * 1.5),
      time: timeStr
    });
  }
  updateAverages();

  if (toggleAuto) {
    toggleAuto.addEventListener('change', async function() {
      const state = this.checked ? '1' : '0';
      if (modeLabel) {
        modeLabel.textContent = this.checked ? 'KONTROL OTOMATIS' : 'MANUAL OVERRIDE';
      }
      try {
        await fetch('/auto?state=' + state);
      } catch (e) {
        console.error('Error toggling auto mode:', e);
      }
    });
  }

  if (togglePump) {
    togglePump.addEventListener('change', async function() {
      const state = this.checked ? '1' : '0';
      if (pumpBadge) {
        pumpBadge.textContent = this.checked ? 'STATUS: AKTIF' : 'STATUS: OFF';
        pumpBadge.className = 'device-badge ' + (this.checked ? 'badge-active' : 'badge-off');
      }
      try {
        await fetch('/pump?state=' + state);
      } catch (e) {
        console.error('Error toggling pump:', e);
      }
    });
  }

  if (toggleFan) {
    toggleFan.addEventListener('change', async function() {
      const state = this.checked ? '1' : '0';
      if (fanBadge) {
        fanBadge.textContent = this.checked ? 'STATUS: AKTIF' : 'STATUS: OFF';
        fanBadge.className = 'device-badge ' + (this.checked ? 'badge-active' : 'badge-off');
      }
      try {
        await fetch('/fan?state=' + state);
      } catch (e) {
        console.error('Error toggling fan:', e);
      }
    });
  }

  // Threshold Config Save Handlers
  const btnSaveSoilThresh = document.getElementById('btnSaveSoilThresh');
  const btnSaveTempThresh = document.getElementById('btnSaveTempThresh');
  const threshSavedBadge = document.getElementById('threshSavedBadge');

  function showSaveToast(message) {
    if (threshSavedBadge) {
      threshSavedBadge.textContent = message || '✓ Threshold Tersimpan';
      threshSavedBadge.style.display = 'inline-block';
      setTimeout(() => {
        threshSavedBadge.style.display = 'none';
      }, 2500);
    }
  }

  async function saveThresholds(soilVal, tempVal) {
    const soil = soilVal || document.getElementById('inputSoilThresh')?.value || 60;
    const temp = tempVal || document.getElementById('inputTempThresh')?.value || 28.0;

    const soilValDisp = document.getElementById('soilValDisp');
    const tempValDisp = document.getElementById('tempValDisp');
    if (soilValDisp) soilValDisp.textContent = soil;
    if (tempValDisp) tempValDisp.textContent = temp;

    try {
      await fetch('/config?soil=' + soil + '&temp=' + temp);
      showSaveToast('✓ Threshold Tersimpan ke ESP32!');
    } catch (e) {
      console.log('Simulation mode save config:', soil, temp);
      showSaveToast('✓ Threshold Tersimpan');
    }
  }

  if (btnSaveSoilThresh) {
    btnSaveSoilThresh.addEventListener('click', function() {
      saveThresholds();
    });
  }

  if (btnSaveTempThresh) {
    btnSaveTempThresh.addEventListener('click', function() {
      saveThresholds();
    });
  }

  window.addEventListener('resize', renderChart);
  setInterval(pollData, REFRESH_MS);
  pollData();
})();