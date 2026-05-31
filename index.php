<?php require_once 'db.php'; ?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="PackSmart — Intelligent box finder that eliminates wasteful packaging. Enter dimensions manually or scan objects with your camera.">
    <title>PackSmart — Smart Box Finder</title>

    <!-- Google Fonts: Inter -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

    <!-- Font Awesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

    <!-- Bootstrap 5.3.2 CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

    <!-- Custom Styles -->
    <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="container my-4 custom-container">
    <div class="header">
        <h1><i class="fa-solid fa-box-open"></i> PackSmart</h1>
        <p>Intelligent Box Finder · Zero Waste Packaging</p>
    </div>

    <div class="card p-4 custom-card">
        <!-- Tabs -->
        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('manual', this)">
                <i class="fa-solid fa-pen-ruler"></i> Manual
            </button>
            <button class="tab-btn" onclick="switchTab('camera', this)">
                <i class="fa-solid fa-camera"></i> Camera Scan
            </button>
        </div>

        <!-- ── Manual Tab ── -->
        <div id="manual" class="tab-content active">
            <form method="POST">
                <div class="form-group mb-3">
                    <label class="input-label">Length (cm)</label>
                    <input type="number" name="length" id="inputLength" placeholder="e.g. 25.0" step="0.1" min="0.1" required
                           value="<?php echo htmlspecialchars($_POST['length'] ?? ''); ?>">
                </div>
                <div class="form-group mb-3">
                    <label class="input-label">Width (cm)</label>
                    <input type="number" name="width" id="inputWidth" placeholder="e.g. 15.0" step="0.1" min="0.1" required
                           value="<?php echo htmlspecialchars($_POST['width'] ?? ''); ?>">
                </div>
                <div class="form-group mb-3">
                    <label class="input-label">Height (cm)</label>
                    <input type="number" name="height" id="inputHeight" placeholder="e.g. 10.0" step="0.1" min="0.1" required
                           value="<?php echo htmlspecialchars($_POST['height'] ?? ''); ?>">
                </div>
                <button type="submit" class="btn-submit">
                    <i class="fa-solid fa-magnifying-glass"></i> Find Best Box
                </button>
            </form>

            <?php
            if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['length'], $_POST['width'], $_POST['height'])) {
                $l = floatval($_POST['length']);
                $w = floatval($_POST['width']);
                $h = floatval($_POST['height']);

                if ($l > 0 && $w > 0 && $h > 0) {
                    $sql = "SELECT * FROM boxes ORDER BY (length * width * height) ASC";
                    $res = mysqli_query($conn, $sql);

                    $bestBox = null;
                    while ($row = mysqli_fetch_assoc($res)) {
                        $pad = floatval($row['padding'] ?? 1.0);
                        $dims_item = [$l + $pad, $w + $pad, $h + $pad];
                        $dims_box  = [$row['length'], $row['width'], $row['height']];
                        sort($dims_item);
                        sort($dims_box);
                        if ($dims_item[0] <= $dims_box[0] &&
                            $dims_item[1] <= $dims_box[1] &&
                            $dims_item[2] <= $dims_box[2]) {
                            $bestBox = $row;
                            break;
                        }
                    }
                    mysqli_free_result($res);

                    $vol = $l * $w * $h;

                    if ($bestBox) {
                        $boxVol = $bestBox['length'] * $bestBox['width'] * $bestBox['height'];
                        $waste  = round(($boxVol - $vol) / $boxVol * 100, 1);
                        ?>
                        <div class="result-box result-success mt-4">
                            <h3><i class="fa-solid fa-circle-check"></i> <?php echo htmlspecialchars($bestBox['name']); ?></h3>
                            <div class="dims-grid">
                                <div class="dim-card"><div class="dim-val"><?php echo $bestBox['length']; ?></div><div class="dim-lbl">Length (cm)</div></div>
                                <div class="dim-card"><div class="dim-val"><?php echo $bestBox['width'];  ?></div><div class="dim-lbl">Width (cm)</div></div>
                                <div class="dim-card"><div class="dim-val"><?php echo $bestBox['height']; ?></div><div class="dim-lbl">Height (cm)</div></div>
                            </div>
                            <div class="two-col mt-2">
                                <div class="dim-card"><div class="dim-val"><?php echo $waste; ?>%</div><div class="dim-val"><?php echo number_format($boxVol); ?> cm³</div><div class="dim-lbl">Waste / Box Volume</div></div>
                            </div>
                        </div>
                        <?php
                    } else {
                        $cl = ceil($l * 1.1);
                        $cw = ceil($w * 1.1);
                        $ch = ceil($h * 1.1);
                        ?>
                        <div class="result-box result-warning mt-4">
                            <h3><i class="fa-solid fa-screwdriver-wrench"></i> Custom Box Required</h3>
                            <p>Your item: <?php echo round($l); ?> × <?php echo round($w); ?> × <?php echo round($h); ?> cm</p>
                            <p><strong>Suggested order: <?php echo $cl; ?> × <?php echo $cw; ?> × <?php echo $ch; ?> cm</strong></p>
                        </div>
                        <?php
                    }
                }
            }
            ?>
        </div>

        <!-- ── Camera Tab ── -->
        <div id="camera" class="tab-content">
            <!-- Reference Object Selector -->
            <div class="ref-info">
                <strong><i class="fa-solid fa-ruler"></i> Reference Object:</strong>
                <select id="refObject" onchange="updateRefSize()">
                    <option value="8.56">Credit Card (8.56 cm)</option>
                    <option value="1.95">₹10 Coin (1.95 cm)</option>
                    <option value="21">A4 Paper Width (21 cm)</option>
                    <option value="0">Custom…</option>
                </select>
                <input type="number" id="refSizeCm" placeholder="Enter size in cm" step="0.1" min="0.1"
                       style="display:none; margin-top:8px;">
            </div>

            <!-- Scan Steps -->
            <div class="scan-steps">
                <div class="scan-step active" id="step1">
                    <span class="step-num">1</span>
                    <span>Place <strong>reference object</strong> + <strong>item</strong> on flat surface</span>
                </div>
                <div class="scan-step" id="step2">
                    <span class="step-num">2</span>
                    <span>Scan front face for <strong>length × width</strong></span>
                </div>
                <div class="scan-step" id="step3">
                    <span class="step-num">3</span>
                    <span>Rotate item 90° and scan for <strong>depth</strong></span>
                </div>
            </div>

            <!-- Camera Display -->
            <div class="cam-box" id="camDisplay">
                <i class="fa-solid fa-camera" style="font-size:2.5rem; opacity:0.5;"></i>
                <span style="opacity:0.7; margin-top:8px;">Click "Start Camera" to begin</span>
            </div>

            <canvas id="canvas" style="display:none;"></canvas>

            <!-- Camera Buttons -->
            <div class="cam-btns">
                <button class="btn-cam btn-start" id="btnStart" onclick="startCamera()">
                    <i class="fa-solid fa-play"></i> Start
                </button>
                <button class="btn-cam btn-scan" id="btnScan" onclick="scanObject()" disabled>
                    <i class="fa-solid fa-crosshairs"></i> Scan
                </button>
                <button class="btn-cam btn-stop" id="btnStop" onclick="stopCamera()" disabled>
                    <i class="fa-solid fa-stop"></i> Stop
                </button>
            </div>

            <!-- Confidence Indicator -->
            <div class="confidence-container" id="confidenceContainer" style="display:none;">
                <div class="confidence-label">
                    <span>Detection Confidence</span>
                    <span id="confidencePercent">0%</span>
                </div>
                <div class="confidence-bar">
                    <div class="confidence-fill" id="confidenceFill" style="width:0%"></div>
                </div>
            </div>

            <!-- Status -->
            <div class="status-box" id="camStatus">OpenCV loading…</div>

            <!-- Results -->
            <div id="camResult" style="display:none;">
                <div class="result-box result-success mt-4">
                    <h3><i class="fa-solid fa-box"></i> Detected Dimensions</h3>
                    <div class="dims-grid">
                        <div class="dim-card">
                            <div class="dim-val" id="dL">--</div>
                            <div class="dim-lbl">Length (cm)</div>
                        </div>
                        <div class="dim-card">
                            <div class="dim-val" id="dW">--</div>
                            <div class="dim-lbl">Width (cm)</div>
                        </div>
                        <div class="dim-card">
                            <div class="dim-val" id="dH">--</div>
                            <div class="dim-lbl">Height (cm)</div>
                        </div>
                    </div>
                    <div id="scanPhaseMsg" class="scan-phase-msg">Scan 1 of 2 — Front face captured</div>
                    <button class="use-btn" id="btnUse" onclick="useThisSize()">
                        <i class="fa-solid fa-arrow-right"></i> Use These Dimensions
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Load all JavaScript logic -->
<script src="script.js"></script>
</body>
</html>