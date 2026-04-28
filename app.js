// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// Global State
const AppState = {
    originalImageURL: null,
    cleanedImageURL: null, // Image without text
    ocrResults: [], // { text, bbox: {x0, y0, x1, y1}, fontSize }
    imageWidth: 0,
    imageHeight: 0
};

// UI Elements
const els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    canvasWrapper: document.getElementById('canvas-wrapper'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    
    // Steps
    stepUpload: document.getElementById('step-upload'),
    stepOcr: document.getElementById('step-ocr'),
    stepVectorize: document.getElementById('step-vectorize'),
    stepExport: document.getElementById('step-export'),
    
    // Buttons
    btnOcr: document.getElementById('btn-ocr'),
    btnVectorize: document.getElementById('btn-vectorize'),
    btnExportPdf: document.getElementById('btn-export-pdf'),
    btnExportZip: document.getElementById('btn-export-zip'),
    
    // Zoom
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnResetView: document.getElementById('btn-reset-view'),
    
    // App Flow controls
    btnUndo: document.getElementById('btn-undo'),
    btnNewTask: document.getElementById('btn-new-task')
};

// Initialize Fabric Canvas
const canvas = new fabric.Canvas('main-canvas', {
    selection: false,
    preserveObjectStacking: true
});

// Resize canvas to fit container initially
function resizeCanvasContainer() {
    const rect = els.canvasWrapper.getBoundingClientRect();
    canvas.setWidth(rect.width);
    canvas.setHeight(rect.height);
}
window.addEventListener('resize', resizeCanvasContainer);
resizeCanvasContainer();

// Utility: Show/Hide Loading
function showLoading(text) {
    els.loadingText.textContent = text;
    els.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    els.loadingOverlay.classList.add('hidden');
}

// Utility: Step Management
function setStepActive(stepEl) {
    [els.stepUpload, els.stepOcr, els.stepVectorize, els.stepExport].forEach(el => el.classList.remove('active'));
    stepEl.classList.add('active');
}

function setStepCompleted(stepEl) {
    stepEl.classList.add('completed');
}

// ----------------------------------------------------
// 1. Image Upload
// ----------------------------------------------------
els.dropzone.addEventListener('click', () => els.fileInput.click());

els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
});

els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
});

els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleImageUpload(e.dataTransfer.files[0]);
    }
});

els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleImageUpload(e.target.files[0]);
    }
});

function handleImageUpload(file) {
    if (!file.type.match('image.*')) return;
    
    showLoading('Načítám obrázek...');
    const reader = new FileReader();
    reader.onload = (f) => {
        const dataUrl = f.target.result;
        AppState.originalImageURL = dataUrl;
        
        fabric.Image.fromURL(dataUrl, (img) => {
            canvas.clear();
            
            AppState.imageWidth = img.width;
            AppState.imageHeight = img.height;
            
            // Set image as background object (not canvas background to allow pan/zoom easily)
            img.set({
                id: 'bg-image',
                left: 0,
                top: 0,
                selectable: false,
                evented: false
            });
            
            canvas.add(img);
            
            // Adjust zoom to fit
            resetView();
            
            els.dropzone.classList.add('hidden');
            els.btnNewTask.classList.remove('hidden');
            hideLoading();
            
            setStepCompleted(els.stepUpload);
            setStepActive(els.stepOcr);
            els.btnOcr.disabled = false;
        });
    };
    reader.readAsDataURL(file);
}

// ----------------------------------------------------
// Pan & Zoom Logic
// ----------------------------------------------------
let isDragging = false;
let lastPosX, lastPosY;

canvas.on('mouse:down', function(opt) {
    const evt = opt.e;
    const pointer = canvas.getPointer(evt);
    
    // Najdeme všechny OCR boxy
    const ocrBoxes = canvas.getObjects().filter(o => o.id === 'ocr-box');
    let clickedBoxes = [];
    
    // Které boxy obsahují místo kliknutí?
    ocrBoxes.forEach(obj => {
        if (pointer.x >= obj.left && pointer.x <= obj.left + obj.width &&
            pointer.y >= obj.top && pointer.y <= obj.top + obj.height) {
            clickedBoxes.push(obj);
        }
    });

    // Toggle OCR box selection (vybereme ten nejmenší, pokud se překrývají)
    if (clickedBoxes.length > 0) {
        clickedBoxes.sort((a, b) => (a.width * a.height) - (b.width * b.height));
        const targetBox = clickedBoxes[0];
        
        const ocrId = targetBox.ocrId;
        const item = AppState.ocrResults.find(r => r.id === ocrId);
        if (item) {
            item.selected = !item.selected;
            if (item.selected) {
                targetBox.set({
                    fill: 'rgba(239, 68, 68, 0.2)',
                    stroke: 'rgba(239, 68, 68, 1)',
                    strokeDashArray: null
                });
            } else {
                targetBox.set({
                    fill: 'rgba(255, 255, 255, 0.05)',
                    stroke: 'rgba(255, 255, 255, 0.5)',
                    strokeDashArray: [4, 4]
                });
            }
            canvas.requestRenderAll();
        }
        return; // Skip panning if clicking a box
    }

    if (evt.altKey === true || evt.button === 1 || (!opt.target && clickedBoxes.length === 0) || (opt.target && opt.target.id === 'bg-image')) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
    }
});

canvas.on('mouse:move', function(opt) {
    if (isDragging) {
        const e = opt.e;
        const vpt = this.viewportTransform;
        vpt[4] += e.clientX - lastPosX;
        vpt[5] += e.clientY - lastPosY;
        this.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
    }
});

canvas.on('mouse:up', function(opt) {
    canvas.setViewportTransform(this.viewportTransform);
    isDragging = false;
    canvas.selection = true;
});

canvas.on('mouse:wheel', function(opt) {
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    if (zoom > 20) zoom = 20;
    if (zoom < 0.1) zoom = 0.1;
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    opt.e.preventDefault();
    opt.e.stopPropagation();
});

function resetView() {
    if (!AppState.imageWidth) return;
    const rect = els.canvasWrapper.getBoundingClientRect();
    const scaleX = rect.width / AppState.imageWidth;
    const scaleY = rect.height / AppState.imageHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9; // 90% of screen
    
    canvas.setViewportTransform([1,0,0,1,0,0]);
    canvas.setZoom(scale);
    
    // Center it
    const vpt = canvas.viewportTransform;
    vpt[4] = (rect.width - AppState.imageWidth * scale) / 2;
    vpt[5] = (rect.height - AppState.imageHeight * scale) / 2;
    canvas.requestRenderAll();
}

els.btnZoomIn.addEventListener('click', () => {
    let zoom = canvas.getZoom();
    canvas.setZoom(zoom * 1.2);
});
els.btnZoomOut.addEventListener('click', () => {
    let zoom = canvas.getZoom();
    canvas.setZoom(zoom / 1.2);
});
els.btnResetView.addEventListener('click', resetView);

// ----------------------------------------------------
// 2. OCR Detection via Tesseract.js
// ----------------------------------------------------
els.btnOcr.addEventListener('click', async () => {
    showLoading('Provádím OCR detekci...');
    els.btnOcr.disabled = true;
    
    try {
        const ret = await Tesseract.recognize(
            AppState.originalImageURL,
            'ces+eng',
            { logger: m => console.log(m) }
        );
        
        AppState.ocrResults = [];
        
        // Process words to draw bounding boxes
        ret.data.words.forEach((word, index) => {
            if (word.text.trim().length === 0) return;
            
            const bbox = word.bbox; // {x0, y0, x1, y1}
            AppState.ocrResults.push({
                id: index,
                text: word.text,
                bbox: bbox,
                confidence: word.confidence,
                selected: true
            });
            
            // Draw Box on Canvas for visual feedback
            const rect = new fabric.Rect({
                left: bbox.x0,
                top: bbox.y0,
                width: bbox.x1 - bbox.x0,
                height: bbox.y1 - bbox.y0,
                fill: 'rgba(239, 68, 68, 0.2)',
                stroke: 'rgba(239, 68, 68, 1)',
                strokeWidth: 2,
                selectable: false,
                evented: true,
                hoverCursor: 'pointer',
                id: 'ocr-box',
                ocrId: index
            });
            canvas.add(rect);
        });
        
        canvas.requestRenderAll();
        
        hideLoading();
        setStepCompleted(els.stepOcr);
        setStepActive(els.stepVectorize);
        els.btnVectorize.disabled = false;
        
    } catch (e) {
        console.error(e);
        alert('OCR selhalo: ' + (e.message || JSON.stringify(e)));
        hideLoading();
        els.btnOcr.disabled = false;
    }
});

// ----------------------------------------------------
// 3. Remove Text & Vectorize
// ----------------------------------------------------
els.btnVectorize.addEventListener('click', async () => {
    showLoading('Generuji vektorový text a odstraňuji původní...');
    els.btnVectorize.disabled = true;
    
    // 1. Remove all old OCR boxes
    const objects = canvas.getObjects();
    const boxes = objects.filter(o => o.id === 'ocr-box');
    boxes.forEach(b => canvas.remove(b));
    
    // 2. Erase text from background (Mock Inpainting)
    // We will create a clean canvas, draw the image, and fill the text bboxes with surrounding color approximation
    await mockClientInpaint();
    
    // 3. Add Vector Text (Arial)
    const selectedTexts = AppState.ocrResults.filter(r => r.selected);
    
    selectedTexts.forEach(item => {
        const bbox = item.bbox;
        const width = bbox.x1 - bbox.x0;
        const height = bbox.y1 - bbox.y0;
        
        // Font size calculation: height of the bbox is approximately the line height
        // We set font size slightly smaller and adjust width
        const fontSize = height * 0.85; 
        
        const fText = new fabric.Text(item.text, {
            left: bbox.x0,
            top: bbox.y0,
            fontFamily: 'Arial',
            fontSize: fontSize,
            fill: '#000000', // Default black, could extract average color later
            originX: 'left',
            originY: 'top',
            id: 'vector-text'
        });
        
        // Typographic mismatch handling (Scale X if it overflows the original box)
        const textWidth = fText.getScaledWidth();
        if (textWidth > width) {
            fText.set('scaleX', width / textWidth);
        }
        
        canvas.add(fText);
    });
    
    canvas.requestRenderAll();
    hideLoading();
    
    setStepCompleted(els.stepVectorize);
    setStepActive(els.stepExport);
    els.btnExportPdf.disabled = false;
    els.btnExportZip.disabled = false;
    els.btnUndo.classList.remove('hidden');
});

// Mock Inpainting function using Canvas 2D API
async function mockClientInpaint() {
    return new Promise((resolve) => {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = AppState.imageWidth;
        offCanvas.height = AppState.imageHeight;
        const ctx = offCanvas.getContext('2d');
        
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
            
            // For each bbox, fill it with the color of the pixel just outside its top-left corner
            // In a real app, you would send the mask to a Python backend here.
            const selectedTexts = AppState.ocrResults.filter(r => r.selected);
            selectedTexts.forEach(item => {
                const b = item.bbox;
                const expand = 2; // Expand slightly to cover anti-aliasing
                
                // Get sample color
                let sampleX = Math.max(0, b.x0 - 5);
                let sampleY = Math.max(0, b.y0 - 5);
                const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                const r = pixel[0], g = pixel[1], b_val = pixel[2];
                
                ctx.fillStyle = `rgb(${r},${g},${b_val})`;
                
                // Simple blur/fill
                ctx.fillRect(b.x0 - expand, b.y0 - expand, (b.x1 - b.x0) + expand*2, (b.y1 - b.y0) + expand*2);
            });
            
            // Update the background image in Fabric
            AppState.cleanedImageURL = offCanvas.toDataURL('image/png');
            
            fabric.Image.fromURL(AppState.cleanedImageURL, (newBg) => {
                const oldBg = canvas.getObjects().find(o => o.id === 'bg-image');
                if (oldBg) {
                    canvas.remove(oldBg);
                }
                
                newBg.set({
                    id: 'bg-image',
                    left: 0,
                    top: 0,
                    selectable: false,
                    evented: false
                });
                
                // Add to very bottom
                canvas.insertAt(newBg, 0);
                resolve();
            });
        };
        img.src = AppState.originalImageURL;
    });
}

// ----------------------------------------------------
// 4. Export
// ----------------------------------------------------

// ZIP Export (PNG bg + SVG text)
els.btnExportZip.addEventListener('click', async () => {
    showLoading('Generuji ZIP balíček...');
    try {
        const zip = new JSZip();
        
        // 1. Add background PNG
        const base64Data = AppState.cleanedImageURL.split(',')[1];
        zip.file("background_cleaned.png", base64Data, {base64: true});
        
        // 2. Extract texts into a clean Canvas to generate SVG without background
        const svgCanvas = new fabric.StaticCanvas(null, { width: AppState.imageWidth, height: AppState.imageHeight });
        const texts = canvas.getObjects().filter(o => o.id === 'vector-text');
        
        texts.forEach(t => {
            t.clone((cloned) => {
                svgCanvas.add(cloned);
            });
        });
        
        const svgString = svgCanvas.toSVG();
        zip.file("vector_text.svg", svgString);
        
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "DeText_Export.zip");
        
        hideLoading();
    } catch (e) {
        console.error(e);
        alert('Chyba při exportu ZIP.');
        hideLoading();
    }
});

// PDF Export via pdf-lib
els.btnExportPdf.addEventListener('click', async () => {
    showLoading('Sestavuji vrstvené PDF...');
    try {
        const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
        const pdfDoc = await PDFDocument.create();
        
        // Add Page matching image size
        const page = pdfDoc.addPage([AppState.imageWidth, AppState.imageHeight]);
        
        // 1. Embed background image
        const imgBytes = await fetch(AppState.cleanedImageURL).then(res => res.arrayBuffer());
        const pdfImage = await pdfDoc.embedPng(imgBytes);
        
        page.drawImage(pdfImage, {
            x: 0,
            y: 0,
            width: AppState.imageWidth,
            height: AppState.imageHeight,
        });
        
        // 2. Embed Arial (Helvetica as standard font)
        const customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // 3. Add Texts
        const texts = canvas.getObjects().filter(o => o.id === 'vector-text');
        
        texts.forEach(t => {
            // pdf-lib coordinate system is bottom-left (y goes up)
            // Fabric.js is top-left (y goes down)
            const pdfY = AppState.imageHeight - t.top - (t.fontSize || 12);
            
            // Optional: apply text color
            let r=0, g=0, b=0;
            if(t.fill && t.fill.startsWith('#') && t.fill.length === 7) {
                 const hex = t.fill.replace('#','');
                 r = parseInt(hex.substring(0,2), 16) / 255;
                 g = parseInt(hex.substring(2,4), 16) / 255;
                 b = parseInt(hex.substring(4,6), 16) / 255;
            }
            
            page.drawText(t.text, {
                x: t.left,
                y: pdfY,
                size: t.fontSize,
                font: customFont,
                color: rgb(r, g, b)
            });
        });
        
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        saveAs(blob, "DeText_Export.pdf");
        
        hideLoading();
    } catch (e) {
        console.error(e);
        alert('Chyba při sestavování PDF.');
        hideLoading();
    }
});

// ----------------------------------------------------
// 5. App Flow Controls (Undo & Reset)
// ----------------------------------------------------

els.btnNewTask.addEventListener('click', () => {
    // Reset AppState
    AppState.originalImageURL = null;
    AppState.cleanedImageURL = null;
    AppState.ocrResults = [];
    AppState.imageWidth = 0;
    AppState.imageHeight = 0;
    
    // Reset Canvas
    canvas.clear();
    
    // Reset UI
    els.dropzone.classList.remove('hidden');
    els.btnUndo.classList.add('hidden');
    els.btnNewTask.classList.add('hidden');
    
    // Reset Steps
    [els.stepUpload, els.stepOcr, els.stepVectorize, els.stepExport].forEach(el => {
        el.classList.remove('active', 'completed');
    });
    setStepActive(els.stepUpload);
    
    els.btnOcr.disabled = true;
    els.btnVectorize.disabled = true;
    els.btnExportPdf.disabled = true;
    els.btnExportZip.disabled = true;
});

els.btnUndo.addEventListener('click', () => {
    // Remove all vector texts
    const objects = canvas.getObjects();
    const texts = objects.filter(o => o.id === 'vector-text');
    texts.forEach(t => canvas.remove(t));
    
    // Revert background to original
    fabric.Image.fromURL(AppState.originalImageURL, (img) => {
        const oldBg = canvas.getObjects().find(o => o.id === 'bg-image');
        if (oldBg) canvas.remove(oldBg);
        
        img.set({
            id: 'bg-image',
            left: 0,
            top: 0,
            selectable: false,
            evented: false
        });
        canvas.insertAt(img, 0);
        
        // Re-draw OCR boxes based on saved state
        AppState.ocrResults.forEach(item => {
            const bbox = item.bbox;
            const rect = new fabric.Rect({
                left: bbox.x0,
                top: bbox.y0,
                width: bbox.x1 - bbox.x0,
                height: bbox.y1 - bbox.y0,
                fill: item.selected ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                stroke: item.selected ? 'rgba(239, 68, 68, 1)' : 'rgba(255, 255, 255, 0.5)',
                strokeDashArray: item.selected ? null : [4, 4],
                strokeWidth: 2,
                selectable: false,
                evented: true,
                hoverCursor: 'pointer',
                id: 'ocr-box',
                ocrId: item.id
            });
            canvas.add(rect);
        });
        
        // Reset UI Steps
        els.stepVectorize.classList.remove('completed');
        els.stepExport.classList.remove('active');
        setStepActive(els.stepVectorize);
        
        els.btnExportPdf.disabled = true;
        els.btnExportZip.disabled = true;
        els.btnVectorize.disabled = false;
        
        els.btnUndo.classList.add('hidden');
    });
});
