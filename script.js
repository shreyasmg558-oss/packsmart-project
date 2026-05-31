// ================================================================
// PACKSMART — SMART PACKAGING CAMERA DETECTION SYSTEM
// Rewritten OpenCV.js pipeline with accurate object measurement
// ================================================================


// ================================================================
// OPENCV LOADER
// ================================================================

let cvReady = false;

function loadOpenCV() {
    const status = document.getElementById('camStatus');
    status.textContent = '⏳ Loading OpenCV…';

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;

    script.onload = function () {
        const checkCV = setInterval(() => {
            if (typeof cv !== 'undefined' && cv.getBuildInformation) {
                clearInterval(checkCV);
                cvReady = true;
                status.textContent = '✅ OpenCV Ready — Start camera to begin';
                status.classList.add('status-ready');
                console.log('OpenCV loaded');
            }
        }, 300);
    };

    script.onerror = function () {
        status.textContent = '❌ Failed to load OpenCV. Check your connection.';
        status.classList.add('status-error');
    };

    document.head.appendChild(script);
}

document.addEventListener('DOMContentLoaded', loadOpenCV);


// ================================================================
// GLOBAL STATE
// ================================================================

let videoStream = null;
let videoEl = null;
let workCanvas = null;
let workCtx = null;
let scanLoopId = null;          // requestAnimationFrame ID
let isScanning = false;

// Two-scan depth workflow
let scanPhase = 0;              // 0 = not scanned, 1 = front done, 2 = side done
let frontDims = { l: 0, w: 0 }; // from scan 1
let sideDims = { l: 0, w: 0 };  // from scan 2
let detectedValues = { l: 0, w: 0, h: 0 };

// Measurement stabilization — moving average over last N frames
const HISTORY_SIZE = 8;
let measureHistory = [];

// Last detected objects for overlay persistence
let lastTargetRect = null;
let lastRefRect = null;
let lastPxPerCm = 0;
let lastConfidence = 0;


// ================================================================
// TAB SWITCHER
// ================================================================

function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}


// ================================================================
// REFERENCE OBJECT
// ================================================================

function updateRefSize() {
    const val = document.getElementById('refObject').value;
    const custom = document.getElementById('refSizeCm');
    custom.style.display = val === '0' ? 'block' : 'none';
}

function getRefSizeCm() {
    const val = parseFloat(document.getElementById('refObject').value);
    if (val === 0 || isNaN(val)) {
        return parseFloat(document.getElementById('refSizeCm').value) || 8.56;
    }
    return val;
}


// ================================================================
// START CAMERA
// ================================================================

async function startCamera() {
    const display = document.getElementById('camDisplay');
    const status = document.getElementById('camStatus');

    if (!cvReady) {
        status.textContent = '⏳ OpenCV still loading — please wait…';
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        display.innerHTML = `
            <video id="videoEl" autoplay playsinline muted
                   style="width:100%;height:100%;object-fit:cover;display:block;">
            </video>
            <canvas id="overlayCanvas"
                    style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
            </canvas>
        `;

        videoEl = document.getElementById('videoEl');
        videoEl.srcObject = stream;
        videoStream = stream;

        workCanvas = document.getElementById('canvas');
        workCtx = workCanvas.getContext('2d');

        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnScan').disabled = false;
        document.getElementById('btnStop').disabled = false;

        // Reset scan state
        scanPhase = 0;
        measureHistory = [];
        lastTargetRect = null;
        lastRefRect = null;
        updateScanSteps(0);

        status.textContent = '📷 Camera active — Place reference object + item, then click Scan';

    } catch (err) {
        status.textContent = '❌ Camera Error: ' + err.message;
        status.classList.add('status-error');
    }
}


// ================================================================
// STOP CAMERA
// ================================================================

function stopCamera() {
    stopScanLoop();

    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    videoStream = null;
    videoEl = null;

    const display = document.getElementById('camDisplay');
    display.classList.remove('scanning');
    display.innerHTML = `
        <i class="fa-solid fa-camera" style="font-size:2.5rem;opacity:0.5;"></i>
        <span style="opacity:0.7;margin-top:8px;">Click "Start Camera" to begin</span>
    `;

    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnScan').disabled = true;
    document.getElementById('btnStop').disabled = true;
    document.getElementById('camStatus').textContent = '⏹ Camera stopped';
    document.getElementById('camResult').style.display = 'none';

    const conf = document.getElementById('confidenceContainer');
    if (conf) conf.style.display = 'none';

    scanPhase = 0;
    measureHistory = [];
    lastTargetRect = null;
    lastRefRect = null;
    updateScanSteps(0);
}


// ================================================================
// SCAN CONTROL — Starts / stops continuous detection loop
// ================================================================

function scanObject() {
    if (!cvReady || !videoEl) {
        document.getElementById('camStatus').textContent = '❌ Camera/OpenCV not ready';
        return;
    }

    if (isScanning) {
        // Already scanning — this click captures the current measurement
        captureScanPhase();
        return;
    }

    // Start continuous scanning
    isScanning = true;
    measureHistory = [];
    document.getElementById('camDisplay').classList.add('scanning');
    document.getElementById('btnScan').innerHTML = '<i class="fa-solid fa-check"></i> Capture';
    document.getElementById('btnScan').classList.add('btn-capture');
    document.getElementById('camStatus').textContent = '🔍 Scanning… hold steady, then click Capture';

    const conf = document.getElementById('confidenceContainer');
    if (conf) conf.style.display = 'block';

    runScanLoop();
}

function stopScanLoop() {
    isScanning = false;
    if (scanLoopId) {
        cancelAnimationFrame(scanLoopId);
        scanLoopId = null;
    }
    document.getElementById('camDisplay')?.classList.remove('scanning');

    const btnScan = document.getElementById('btnScan');
    if (btnScan) {
        btnScan.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Scan';
        btnScan.classList.remove('btn-capture');
    }
}


// ================================================================
// CONTINUOUS SCAN LOOP — runs detection at ~5 fps
// ================================================================

let lastDetectTime = 0;
const DETECT_INTERVAL = 200; // ms between detections

function runScanLoop() {
    if (!isScanning) return;

    scanLoopId = requestAnimationFrame((timestamp) => {
        if (timestamp - lastDetectTime >= DETECT_INTERVAL) {
            lastDetectTime = timestamp;
            runDetection();
        }
        runScanLoop();
    });
}


// ================================================================
// CORE DETECTION — OpenCV pipeline
// ================================================================

function runDetection() {
    if (!cvReady || !videoEl) return;

    const status = document.getElementById('camStatus');
    const refCm = getRefSizeCm();

    try {
        // Capture frame
        workCanvas.width = videoEl.videoWidth;
        workCanvas.height = videoEl.videoHeight;
        workCtx.drawImage(videoEl, 0, 0, workCanvas.width, workCanvas.height);

        let src = cv.imread(workCanvas);
        let gray = new cv.Mat();
        let blur = new cv.Mat();
        let thresh = new cv.Mat();
        let dilated = new cv.Mat();

        // ── Step 1: Grayscale ──
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // ── Step 2: Bilateral filter to preserve edges while smoothing ──
        // OpenCV.js doesn't have bilateralFilter, use GaussianBlur instead
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

        // ── Step 3: Adaptive thresholding for varied lighting ──
        cv.adaptiveThreshold(
            blur, thresh, 255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY_INV,
            11, 2
        );

        // ── Step 4: Morphological close to fill gaps ──
        let kernelClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
        cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernelClose);

        // ── Step 5: Dilate to strengthen contours ──
        let kernelDilate = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.dilate(thresh, dilated, kernelDilate, new cv.Point(-1, -1), 2);

        // ── Step 6: Also run Canny with Otsu-based thresholds ──
        let edge = new cv.Mat();
        const mean = cv.mean(blur);
        const medianApprox = mean[0]; // approximate median with mean
        const cLow = Math.max(0, Math.round(0.33 * medianApprox));
        const cHigh = Math.min(255, Math.round(1.33 * medianApprox));
        cv.Canny(blur, edge, cLow, cHigh);

        // Combine adaptive threshold + Canny
        cv.bitwise_or(dilated, edge, dilated);

        // ── Step 7: Final morphological close ──
        let kernelFinal = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
        cv.morphologyEx(dilated, dilated, cv.MORPH_CLOSE, kernelFinal);

        // ── Step 8: Find contours ──
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // ── Step 9: Filter & score contours ──
        const frameArea = workCanvas.width * workCanvas.height;
        const minArea = frameArea * 0.005;  // at least 0.5% of frame
        const maxArea = frameArea * 0.85;   // no more than 85% of frame
        let candidates = [];

        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);

            if (area < minArea || area > maxArea) {
                cnt.delete();
                continue;
            }

            // Approximate polygon
            let approx = new cv.Mat();
            let peri = cv.arcLength(cnt, true);
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            let vertices = approx.rows;

            // Require roughly rectangular (4-8 vertices)
            if (vertices < 4 || vertices > 12) {
                approx.delete();
                cnt.delete();
                continue;
            }

            // Get rotated bounding rect for better accuracy on angled objects
            let rotRect = cv.minAreaRect(cnt);
            let rw = Math.max(rotRect.size.width, rotRect.size.height);
            let rh = Math.min(rotRect.size.width, rotRect.size.height);

            // Aspect ratio filter: reject very thin objects (likely edges/lines)
            let aspect = rw / (rh || 1);
            if (aspect > 8) {
                approx.delete();
                cnt.delete();
                continue;
            }

            // Solidity = area / convex hull area (how "filled" the contour is)
            let hull = new cv.Mat();
            cv.convexHull(cnt, hull);
            let hullArea = cv.contourArea(hull);
            let solidity = area / (hullArea || 1);
            hull.delete();

            // Reject low-solidity contours (too irregular)
            if (solidity < 0.6) {
                approx.delete();
                cnt.delete();
                continue;
            }

            // Rectangularity = how close to a perfect rectangle
            let rectArea = rw * rh;
            let rectangularity = area / (rectArea || 1);

            // Score: prefer rectangular, solid, reasonably sized
            let score = solidity * 0.3 + rectangularity * 0.3 + (area / maxArea) * 0.4;

            let boundRect = cv.boundingRect(cnt);

            candidates.push({
                contour: cnt,
                approx: approx,
                area: area,
                rotRect: rotRect,
                boundRect: boundRect,
                rw: rw,
                rh: rh,
                aspect: aspect,
                solidity: solidity,
                rectangularity: rectangularity,
                score: score,
                centerX: boundRect.x + boundRect.width / 2,
                centerY: boundRect.y + boundRect.height / 2
            });
        }

        // ── Step 10: Need at least 2 objects (reference + target) ──
        if (candidates.length < 2) {
            // Single object fallback: use the one object but warn about accuracy
            if (candidates.length === 1) {
                let obj = candidates[0];
                let estPxPerCm = obj.rw / refCm; // rough estimate using assumed relationship
                let wCm = (obj.rw / estPxPerCm).toFixed(1);
                let hCm = (obj.rh / estPxPerCm).toFixed(1);

                lastTargetRect = obj.boundRect;
                lastRefRect = null;
                lastPxPerCm = estPxPerCm;
                lastConfidence = 25;

                drawOverlay(obj.boundRect, null, wCm, hCm, refCm);
                updateConfidence(25);

                status.textContent = '⚠ Only 1 object found — place reference object next to item for accurate measurement';
                addToHistory(parseFloat(wCm), parseFloat(hCm));
                updateLiveDimensions();
            } else {
                status.textContent = '❌ No objects detected — ensure good contrast against background';
                drawOverlay(null, null, 0, 0, 0);
                updateConfidence(0);
            }

            cleanupMats(src, gray, blur, thresh, dilated, edge, kernelClose, kernelDilate, kernelFinal, contours, hierarchy);
            candidates.forEach(c => { c.approx.delete(); c.contour.delete(); });
            return;
        }

        // ── Step 11: Sort by area, identify reference vs target ──
        candidates.sort((a, b) => b.area - a.area);

        // The largest object is the target, the second-largest is the reference
        // (assuming the item is bigger than the credit card/coin)
        let target, reference;

        // Strategy: try to find an object whose dimensions match a known reference size ratio
        // Credit card aspect ratio ≈ 1.586, coin ≈ 1.0
        // If we can match, use that as reference; otherwise assume 2nd largest
        let refVal = getRefSizeCm();
        let bestRefIdx = -1;
        let bestRefScore = 0;

        for (let i = 0; i < Math.min(candidates.length, 5); i++) {
            let c = candidates[i];
            let refScore = 0;

            // Credit card: 8.56 x 5.398 cm → aspect ≈ 1.586
            if (Math.abs(refVal - 8.56) < 0.1) {
                let aspectDiff = Math.abs(c.aspect - 1.586);
                refScore = Math.max(0, 1 - aspectDiff * 2) * c.rectangularity;
            }
            // Coin: essentially circular → aspect ≈ 1.0
            else if (Math.abs(refVal - 1.95) < 0.1) {
                let aspectDiff = Math.abs(c.aspect - 1.0);
                refScore = Math.max(0, 1 - aspectDiff * 3) * c.solidity;
            }
            // A4 paper: 29.7 x 21 → aspect ≈ 1.414
            else if (Math.abs(refVal - 21) < 0.1) {
                let aspectDiff = Math.abs(c.aspect - 1.414);
                refScore = Math.max(0, 1 - aspectDiff * 2) * c.rectangularity;
            }
            // Custom: just use the second largest
            else {
                refScore = (i === 1) ? 1 : 0;
            }

            if (refScore > bestRefScore) {
                bestRefScore = refScore;
                bestRefIdx = i;
            }
        }

        // If no good match, default to second-largest
        if (bestRefIdx < 0 || bestRefScore < 0.2) {
            bestRefIdx = 1;
        }

        reference = candidates[bestRefIdx];
        // Target is the largest that isn't the reference
        target = candidates[0].contour === reference.contour ? candidates[1] : candidates[0];

        // ── Step 12: Calculate pixel-to-cm ratio from reference ──
        // Use the LONGER dimension of the reference object's rotated bounding rect
        // divided by the known reference size in cm
        let refPixelSize = reference.rw; // longer dimension in pixels
        let pxPerCm = refPixelSize / refCm;

        // ── Step 13: Calculate target dimensions in cm ──
        let targetWCm = (target.rw / pxPerCm).toFixed(1);
        let targetHCm = (target.rh / pxPerCm).toFixed(1);

        // ── Step 14: Confidence scoring ──
        let confidence = calculateConfidence(target, reference, pxPerCm);

        lastTargetRect = target.boundRect;
        lastRefRect = reference.boundRect;
        lastPxPerCm = pxPerCm;
        lastConfidence = confidence;

        // ── Step 15: Draw overlays ──
        drawOverlay(target.boundRect, reference.boundRect, targetWCm, targetHCm, refCm);
        updateConfidence(confidence);

        // ── Step 16: Add to moving average ──
        addToHistory(parseFloat(targetWCm), parseFloat(targetHCm));
        updateLiveDimensions();

        if (confidence > 60) {
            status.textContent = `🔍 Tracking… ${targetWCm} × ${targetHCm} cm — Click Capture when stable`;
        } else {
            status.textContent = '⚠ Low confidence — adjust lighting or object position';
        }

        // ── Cleanup ──
        candidates.forEach(c => {
            try { c.approx.delete(); } catch(e) {}
            try { c.contour.delete(); } catch(e) {}
        });
        cleanupMats(src, gray, blur, thresh, dilated, edge, kernelClose, kernelDilate, kernelFinal, contours, hierarchy);

    } catch (err) {
        console.error('Detection error:', err);
        status.textContent = '❌ Detection error: ' + err.message;
    }
}


// ================================================================
// CONFIDENCE SCORING
// ================================================================

function calculateConfidence(target, reference, pxPerCm) {
    let score = 0;

    // 1. Reference object solidity (max 25 pts)
    score += reference.solidity * 25;

    // 2. Reference object rectangularity (max 20 pts)
    score += reference.rectangularity * 20;

    // 3. Target object solidity (max 20 pts)
    score += target.solidity * 20;

    // 4. Target object rectangularity (max 15 pts)
    score += target.rectangularity * 15;

    // 5. Measurement stability — how consistent is the moving average (max 20 pts)
    if (measureHistory.length >= 3) {
        let wArr = measureHistory.map(m => m.w);
        let hArr = measureHistory.map(m => m.h);
        let wStd = stddev(wArr);
        let hStd = stddev(hArr);
        let avgStd = (wStd + hStd) / 2;
        let stabilityScore = Math.max(0, 20 - avgStd * 10);
        score += stabilityScore;
    }

    return Math.min(100, Math.round(score));
}

function stddev(arr) {
    let mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    let variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}


// ================================================================
// MEASUREMENT STABILIZATION — Moving Average
// ================================================================

function addToHistory(w, h) {
    measureHistory.push({ w, h });
    if (measureHistory.length > HISTORY_SIZE) {
        measureHistory.shift();
    }
}

function getStabilizedMeasurement() {
    if (measureHistory.length === 0) return { w: 0, h: 0 };

    // Weighted moving average: more recent frames get higher weight
    let totalWeight = 0;
    let sumW = 0, sumH = 0;

    measureHistory.forEach((m, i) => {
        let weight = i + 1; // linear ramp: oldest=1, newest=N
        sumW += m.w * weight;
        sumH += m.h * weight;
        totalWeight += weight;
    });

    return {
        w: parseFloat((sumW / totalWeight).toFixed(1)),
        h: parseFloat((sumH / totalWeight).toFixed(1))
    };
}

function updateLiveDimensions() {
    const stable = getStabilizedMeasurement();
    const dL = document.getElementById('dL');
    const dW = document.getElementById('dW');

    if (dL) dL.textContent = stable.w;
    if (dW) dW.textContent = stable.h;

    // Show result panel
    document.getElementById('camResult').style.display = 'block';

    // Update phase message
    const phaseMsg = document.getElementById('scanPhaseMsg');
    if (phaseMsg) {
        if (scanPhase === 0) {
            phaseMsg.textContent = 'Live measurement — Click Capture to lock in values';
        } else if (scanPhase === 1) {
            phaseMsg.textContent = 'Scan 1 ✓ — Now rotate item 90° and scan again for depth';
        }
    }
}


// ================================================================
// TWO-SCAN DEPTH WORKFLOW
// ================================================================

function captureScanPhase() {
    const stable = getStabilizedMeasurement();

    if (scanPhase === 0) {
        // First scan — captures length and width (front face)
        frontDims = { l: Math.max(stable.w, stable.h), w: Math.min(stable.w, stable.h) };
        scanPhase = 1;

        document.getElementById('dL').textContent = frontDims.l;
        document.getElementById('dW').textContent = frontDims.w;
        document.getElementById('dH').textContent = '…';

        updateScanSteps(2); // highlight step 3

        // Reset history for second scan
        measureHistory = [];

        document.getElementById('camStatus').textContent =
            '↻ Rotate item 90° to show the side face, then click Capture again';

        const phaseMsg = document.getElementById('scanPhaseMsg');
        if (phaseMsg) phaseMsg.textContent = 'Scan 1 ✓ — Rotate item 90° and capture again';

    } else if (scanPhase === 1) {
        // Second scan — captures the depth
        sideDims = { l: Math.max(stable.w, stable.h), w: Math.min(stable.w, stable.h) };

        // The depth is the shorter dimension of the side view
        // (the longer dimension should roughly match the front's length)
        let depth = sideDims.w;

        // Final dimensions: length, width, height
        let finalL = frontDims.l;
        let finalW = frontDims.w;
        let finalH = depth;

        detectedValues = { l: finalL, w: finalW, h: finalH };

        document.getElementById('dL').textContent = finalL;
        document.getElementById('dW').textContent = finalW;
        document.getElementById('dH').textContent = finalH;

        scanPhase = 2;
        updateScanSteps(3);

        // Stop scanning
        stopScanLoop();

        document.getElementById('camStatus').textContent =
            '✅ All 3 dimensions captured! Click "Use These Dimensions" to find the best box.';

        const phaseMsg = document.getElementById('scanPhaseMsg');
        if (phaseMsg) phaseMsg.textContent = '✅ All dimensions captured — Ready to find best box';

        const btnScan = document.getElementById('btnScan');
        btnScan.innerHTML = '<i class="fa-solid fa-redo"></i> Rescan';
        btnScan.classList.remove('btn-capture');
        btnScan.onclick = () => {
            scanPhase = 0;
            measureHistory = [];
            updateScanSteps(0);
            document.getElementById('camResult').style.display = 'none';
            btnScan.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Scan';
            btnScan.onclick = scanObject;
        };
    }
}


// ================================================================
// SCAN STEPS UI UPDATE
// ================================================================

function updateScanSteps(activeIdx) {
    for (let i = 1; i <= 3; i++) {
        const step = document.getElementById('step' + i);
        if (!step) continue;
        step.classList.remove('active', 'done');

        if (i - 1 < activeIdx && activeIdx > 0) {
            step.classList.add('done');
        } else if (i - 1 === activeIdx || (activeIdx === 0 && i === 1)) {
            step.classList.add('active');
        }
    }
}


// ================================================================
// OVERLAY DRAWING
// ================================================================

function drawOverlay(targetRect, refRect, wCm, hCm, refCm) {
    const overlay = document.getElementById('overlayCanvas');
    if (!overlay) return;

    overlay.width = workCanvas.width;
    overlay.height = workCanvas.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Draw reference object (blue dashed box)
    if (refRect) {
        ctx.strokeStyle = '#00b4ff';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(refRect.x, refRect.y, refRect.width, refRect.height);
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#00b4ff';
        ctx.font = 'bold 16px Inter, Arial, sans-serif';
        const refLabel = `Ref: ${refCm} cm`;
        const refMetrics = ctx.measureText(refLabel);
        const refLabelX = refRect.x;
        const refLabelY = refRect.y - 8;

        // Background for readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(refLabelX - 4, refLabelY - 16, refMetrics.width + 8, 22);
        ctx.fillStyle = '#00b4ff';
        ctx.fillText(refLabel, refLabelX, refLabelY);
    }

    // Draw target object (green solid box)
    if (targetRect) {
        ctx.strokeStyle = '#2ed573';
        ctx.lineWidth = 4;
        ctx.setLineDash([]);
        ctx.strokeRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

        // Corner markers
        const cornerLen = 15;
        ctx.lineWidth = 6;
        const cx = targetRect.x, cy = targetRect.y;
        const cw = targetRect.width, ch = targetRect.height;

        // Top-left
        ctx.beginPath();
        ctx.moveTo(cx, cy + cornerLen); ctx.lineTo(cx, cy); ctx.lineTo(cx + cornerLen, cy);
        ctx.stroke();
        // Top-right
        ctx.beginPath();
        ctx.moveTo(cx + cw - cornerLen, cy); ctx.lineTo(cx + cw, cy); ctx.lineTo(cx + cw, cy + cornerLen);
        ctx.stroke();
        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(cx, cy + ch - cornerLen); ctx.lineTo(cx, cy + ch); ctx.lineTo(cx + cornerLen, cy + ch);
        ctx.stroke();
        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(cx + cw - cornerLen, cy + ch); ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx + cw, cy + ch - cornerLen);
        ctx.stroke();

        // Dimension label
        ctx.lineWidth = 1;
        const label = `${wCm} × ${hCm} cm`;
        ctx.font = 'bold 20px Inter, Arial, sans-serif';
        const metrics = ctx.measureText(label);
        const labelX = targetRect.x;
        const labelY = targetRect.y - 12;

        // Background for readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(labelX - 6, labelY - 22, metrics.width + 12, 30);
        ctx.fillStyle = '#2ed573';
        ctx.fillText(label, labelX, labelY);
    }
}


// ================================================================
// CONFIDENCE UI
// ================================================================

function updateConfidence(percent) {
    const container = document.getElementById('confidenceContainer');
    const fill = document.getElementById('confidenceFill');
    const text = document.getElementById('confidencePercent');

    if (!container || !fill || !text) return;

    container.style.display = 'block';
    fill.style.width = percent + '%';
    text.textContent = percent + '%';

    // Color: red → yellow → green
    let color;
    if (percent < 35) {
        color = '#ff4757';
    } else if (percent < 65) {
        color = '#ffc107';
    } else {
        color = '#2ed573';
    }
    fill.style.background = color;
}


// ================================================================
// SHOW DETECTED SIZE
// ================================================================

function showDetected(l, w, h) {
    detectedValues = { l, w, h };
    document.getElementById('dL').textContent = l;
    document.getElementById('dW').textContent = w;
    document.getElementById('dH').textContent = (h === '?' ? '—' : h);
    document.getElementById('camResult').style.display = 'block';
}


// ================================================================
// MEMORY CLEANUP
// ================================================================

function cleanupMats(...mats) {
    mats.forEach(mat => {
        try { mat.delete(); } catch(e) {}
    });
}


// ================================================================
// USE DETECTED SIZE — Transfer to manual tab
// ================================================================

function useThisSize() {
    const { l, w, h } = detectedValues;

    // If we haven't completed the two-scan workflow, use what we have
    if (scanPhase < 2) {
        const stable = getStabilizedMeasurement();
        if (scanPhase === 0) {
            detectedValues.l = Math.max(stable.w, stable.h);
            detectedValues.w = Math.min(stable.w, stable.h);
            detectedValues.h = 0;
        }
    }

    const manualBtn = document.querySelector('.tab-btn');
    switchTab('manual', manualBtn);

    const inputL = document.getElementById('inputLength');
    const inputW = document.getElementById('inputWidth');
    const inputH = document.getElementById('inputHeight');

    if (inputL) inputL.value = detectedValues.l || '';
    if (inputW) inputW.value = detectedValues.w || '';
    if (inputH) inputH.value = detectedValues.h || '';

    if (!detectedValues.h || detectedValues.h === 0) {
        alert('Height (depth) was not measured.\nPlease enter the height manually, or go back and complete the 2-scan workflow.');
        if (inputH) inputH.focus();
    }
}