/**
 * kingnwaf — Content Script v3 (إصلاح شامل)
 * ================================================
 * المشاكل المُصلَحة:
 * 1. msg() بدون timeout → الآن msgTimeout() مع 5-10 ثوانٍ
 * 2. كشف الصور ضيق جداً → الآن يبحث في كل الصفحة
 * 3. تحديد الكلمة الواحدة لا يترجم → مُصلَح
 * 4. النافذة لا تغلق عند النقر خارجها → مُضاف
 * 5. Tesseract يُحمَّل أكثر من مرة → إدارة حالة كاملة
 * 6. OCR PSM=6 (كتلة نص) → الآن PSM=11 (نص متفرق = مثالي للمانغا)
 * 7. دعم PDF محدود → موسّع
 * 8. لا يوجد سياق عند الحفظ → مُضاف
 * 9. Alt+S لا يدعم لوحة المفاتيح العربية (س) → مُضاف
 */

(function () {
  'use strict';

  // ============================================================
  // الحالة العامة
  // ============================================================
  let settings = { enabled: true, wordColoring: false, forceAllText: false };
  let popup = null;
  let ocrOverlay = null;
  let isOCRMode = false;
  let savedWords = [];
  let clickTimer = null;
  let tesseractState = 'idle'; // idle | loading | ready | failed

  // ============================================================
  // زر المترجم العائم (Floating OCR Button)
  // ============================================================
  function injectOcrButton() {
    if (document.getElementById('kw-ocr-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'kw-ocr-btn';
    btn.innerHTML = '🎯';
    btn.title = 'قص وترجمة من الصورة (Alt+S)';
    document.body.appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isOCRMode) startOCRMode();
    });
  }

  // ============================================================
  // التهيئة
  // ============================================================
  async function init() {
    try {
      const resp = await msgTimeout({ type: 'GET_SETTINGS' }, 3000);
      if (resp && resp.enabled !== undefined) settings = resp;
    } catch (_) {}

    try {
      const s = await chrome.storage.local.get('kw_vocabulary');
      savedWords = s.kw_vocabulary || [];
    } catch (_) {}

    if (settings.wordColoring) applyWordColoring();
    injectOcrButton();
  }
  init();

  // ============================================================
  // استقبال الرسائل من الـ background
  // ============================================================
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'TRANSLATE_SELECTION') handleText(m.text, null);
    if (m.type === 'UPDATE_WORD_COLORING') {
      settings.wordColoring = m.wordColoring;
      settings.forceAllText = m.forceAllText;
      settings.wordColoring ? applyWordColoring() : removeWordColoring();
    }
  });

  // ============================================================
  // إرسال الرسائل مع Timeout (إصلاح جذري)
  // ============================================================
  function msgTimeout(data, timeout) {
    const ms = timeout || 5000;
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ success: false, error: 'timeout بعد ' + ms + 'ms' }),
        ms
      );
      try {
        chrome.runtime.sendMessage(data, (r) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(r != null ? r : { success: false, error: 'لا استجابة' });
          }
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ success: false, error: e.message });
      }
    });
  }

  // ============================================================
  // النقر — كشف نوع المحتوى وتوجيه المعالج
  // ============================================================
  document.addEventListener('click', (e) => {
    if (!settings.enabled) return;
    if (e.target.closest('#kw-popup, #kw-ocr-modal, #kw-ocr-overlay')) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 2) return;

    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => handleClick(e), 60);
  });

  // إغلاق النافذة عند النقر خارجها
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target)) removePopup();
  }, true);

  async function handleClick(e) {
    const x = e.clientX;
    const y = e.clientY;
    const el = document.elementFromPoint(x, y);
    if (!el) return;

    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    // تجاهل عناصر التفاعل
    if (['input', 'textarea', 'select', 'button', 'a'].includes(tag)) return;
    if (el.isContentEditable) return;
    if (el.closest('#kw-popup, #kw-ocr-modal, #kw-ocr-overlay')) return;

    // 1. صورة
    const imgEl = findImageElement(el, x, y);
    if (imgEl) {
      await handleImageElement(imgEl, e);
      return;
    }

    // 2. Canvas
    const canvasEl = tag === 'canvas' ? el : el.closest('canvas');
    if (canvasEl) {
      await handleCanvasElement(canvasEl, e);
      return;
    }

    // 3. طبقة نص PDF
    const pdfText = extractPdfText(el);
    if (pdfText) {
      await handleText(pdfText, e);
      return;
    }

    // 4. نص عادي
    const word = getWordAtPoint(x, y);
    if (word && isLikelyEnglish(word)) {
      await handleText(word, e);
    }
  }

  // ============================================================
  // كشف الصور (موسّع لدعم مواقع المانغا والكوميكس)
  // ============================================================
  function findImageElement(el, x, y) {
    // مباشرة
    if (el.tagName && el.tagName.toLowerCase() === 'img') return el;

    // عنصر أب
    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 6) {
      if (node.tagName && node.tagName.toLowerCase() === 'img') return node;
      node = node.parentElement;
      depth++;
    }

    // حاويات شائعة في مواقع المانغا والكوميكس
    const containers = [
      'figure', 'picture',
      '[role="img"]',
      '[class*="page"]', '[class*="chapter"]',
      '[class*="manga"]', '[class*="comic"]',
      '[class*="reader"]', '[class*="viewer"]',
      '[class*="image"]', '[class*="img"]',
    ];
    for (const sel of containers) {
      try {
        const parent = el.closest(sel);
        if (parent) {
          const img = parent.querySelector('img');
          if (img) {
            const r = img.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return img;
          }
        }
      } catch (_) {}
    }

    // بحث شامل: أي صورة تحت المؤشر
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) continue; // تجاهل الأيقونات الصغيرة
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return img;
    }

    return null;
  }

  // ============================================================
  // استخراج نص PDF (موسّع)
  // ============================================================
  function extractPdfText(el) {
    const pdfSelectors = [
      '.textLayer span',
      '[class*="textLayer"] span',
      '.pdfViewer span',
      '.pdf-text-layer span',
      '[class*="text-layer"] span',
      '[data-main-rotation] span',
    ];

    for (const sel of pdfSelectors) {
      try {
        const isMatch = el.matches ? el.matches(sel) : false;
        const inLayer = el.closest(sel.replace(' span', ''));
        if (!isMatch && !inLayer) continue;

        const span = el.closest('span') || (el.tagName === 'SPAN' ? el : null);
        if (!span) continue;

        const layer = span.closest(
          '.textLayer, [class*="textLayer"], .pdfViewer, .pdf-text-layer'
        );
        if (layer) {
          const text = [...layer.querySelectorAll('span')]
            .map((s) => s.textContent)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text && isLikelyEnglish(text)) return text;
        }

        const txt = span.textContent.trim();
        if (txt && isLikelyEnglish(txt)) return txt;
      } catch (_) {}
    }

    // عارض PDF المدمج في Chrome
    if (
      window.location.href.startsWith('chrome-extension://') &&
      window.location.href.includes('pdf')
    ) {
      return null; // يستخدم المستخدم Alt+S بدلاً من ذلك
    }

    return null;
  }

  // ============================================================
  // التحديد اليدوي → ترجمة فورية
  // ============================================================
  document.addEventListener('mouseup', (e) => {
    if (!settings.enabled) return;
    if (e.target.closest('#kw-popup, #kw-ocr-modal, #kw-ocr-overlay')) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length < 2) return;
      if (!isLikelyEnglish(text)) return;
      clearTimeout(clickTimer);
      handleText(text, e);
    }, 80);
  });

  // ============================================================
  // معالج النص العادي
  // ============================================================
  async function handleText(text, e) {
    const trimmed = text.trim();
    if (!trimmed || !isLikelyEnglish(trimmed)) return;
    if (popup && popup.dataset.text === trimmed) return;

    removePopup();
    popup = buildTranslationPopup(trimmed, null, null, true);
    placePopup(popup, e);
    document.body.appendChild(popup);

    try {
      const result = await msgTimeout({ type: 'TRANSLATE', text: trimmed }, 10000);
      if (!result || !result.success) {
        throw new Error(result ? result.error : 'لا استجابة');
      }
      if (popup && popup.dataset.text === trimmed) {
        updateTranslationResult(popup, result.arabic, result.meaning);
      }
    } catch (err) {
      if (popup && popup.dataset.text === trimmed) {
        updateTranslationError(popup, 'تعذّرت الترجمة: ' + err.message);
      }
    }
  }

  // ============================================================
  // معالج الصور → OCR
  // ============================================================
  async function handleImageElement(imgEl, e) {
    removePopup();
    const modal = buildLoadingModal('🖼️ استخراج النص من الصورة...');

    try {
      const src = imgEl.currentSrc || imgEl.src;
      if (!src || src.startsWith('data:image/gif') || !src.trim()) {
        throw new Error('مصدر الصورة غير صالح');
      }

      const image = await loadImageCORS(src);
      const canvas = cropAroundClick(image, imgEl, e.clientX, e.clientY);
      updateModalStatus(modal, '⚙️ تحليل النص...');
      const text = await runOCR(canvas);
      await finishOCR(modal, text);
    } catch (_err) {
      // بديل: لقطة شاشة للمنطقة حول النقر
      try {
        updateModalStatus(modal, '📷 التقاط المنطقة...');
        const rect = imgEl.getBoundingClientRect();
        const cropW = Math.min(480, rect.width);
        const cropH = Math.min(340, rect.height);
        const cropX = Math.max(rect.left, Math.min(e.clientX - cropW / 2, rect.right - cropW));
        const cropY = Math.max(rect.top, Math.min(e.clientY - cropH / 2, rect.bottom - cropH));
        await ocrViaScreenshot(modal, cropX, cropY, cropW, cropH);
      } catch (_err2) {
        updateModalError(modal, 'تعذّر قراءة الصورة. جرّب Alt+S واسحب فوق المنطقة.');
      }
    }
  }

  // تحميل الصورة مع دعم CORS
  function loadImageCORS(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        // محاولة بدون CORS
        const img2 = new Image();
        img2.onload = () => resolve(img2);
        img2.onerror = () => reject(new Error('فشل تحميل الصورة'));
        img2.src = src;
      };
      img.src = src;
    });
  }

  // ============================================================
  // معالج Canvas → OCR
  // ============================================================
  async function handleCanvasElement(canvasEl, e) {
    removePopup();
    const modal = buildLoadingModal('🎨 استخراج النص...');

    try {
      let dataUrl;
      try {
        dataUrl = canvasEl.toDataURL('image/png');
      } catch (_) {
        // CORS محمي — لقطة شاشة
        const rect = canvasEl.getBoundingClientRect();
        const cropW = Math.min(480, rect.width);
        const cropH = Math.min(340, rect.height);
        const cropX = Math.max(rect.left, Math.min(e.clientX - cropW / 2, rect.right - cropW));
        const cropY = Math.max(rect.top, Math.min(e.clientY - cropH / 2, rect.bottom - cropH));
        updateModalStatus(modal, '📷 التقاط المنطقة...');
        await ocrViaScreenshot(modal, cropX, cropY, cropW, cropH);
        return;
      }

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });

      const canvas = cropAroundClick(img, canvasEl, e.clientX, e.clientY);
      updateModalStatus(modal, '⚙️ تحليل النص...');
      const text = await runOCR(canvas);
      await finishOCR(modal, text);
    } catch (err) {
      updateModalError(modal, 'فشل OCR: ' + err.message);
    }
  }

  // ============================================================
  // Alt+S: وضع OCR يدوي
  // ============================================================
  document.addEventListener('keydown', (e) => {
    // دعم اللوحة الإنجليزية والعربية معاً
    const isAltS =
      e.altKey &&
      (e.key === 's' || e.key === 'S' || e.key === 'س' || e.code === 'KeyS');

    if (isAltS) {
      e.preventDefault();
      if (!isOCRMode) startOCRMode();
    }
    if (e.key === 'Escape') {
      cancelOCRMode();
      removePopup();
    }
  });

  function startOCRMode() {
    isOCRMode = true;
    removePopup();
    document.getElementById('kw-ocr-overlay') &&
      document.getElementById('kw-ocr-overlay').remove();

    ocrOverlay = document.createElement('div');
    ocrOverlay.id = 'kw-ocr-overlay';
    ocrOverlay.innerHTML =
      '<div class="kw-ocr-hint">اسحب لتحديد منطقة النص · Esc للإلغاء</div>' +
      '<div id="kw-ocr-sel"></div>';
    document.body.appendChild(ocrOverlay);

    let sx = 0;
    let sy = 0;
    let dragging = false;
    const selEl = document.getElementById('kw-ocr-sel');

    const onDown = (ev) => {
      dragging = true;
      sx = ev.clientX;
      sy = ev.clientY;
      selEl.style.cssText =
        'left:' + sx + 'px;top:' + sy + 'px;width:0;height:0;display:block';
    };

    const onMove = (ev) => {
      if (!dragging) return;
      const x = Math.min(ev.clientX, sx);
      const y = Math.min(ev.clientY, sy);
      const w = Math.abs(ev.clientX - sx);
      const h = Math.abs(ev.clientY - sy);
      selEl.style.cssText =
        'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;display:block';
    };

    const onUp = (ev) => {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(ev.clientX, sx);
      const y = Math.min(ev.clientY, sy);
      const w = Math.abs(ev.clientX - sx);
      const h = Math.abs(ev.clientY - sy);
      cleanup();
      cancelOCRMode();
      if (w < 10 || h < 10) return;
      performScreenshotOCR(x, y, w, h);
    };

    const cleanup = () => {
      if (ocrOverlay) ocrOverlay.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    ocrOverlay.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function cancelOCRMode() {
    isOCRMode = false;
    if (ocrOverlay) {
      ocrOverlay.remove();
      ocrOverlay = null;
    }
  }

  async function performScreenshotOCR(x, y, w, h) {
    const modal = buildLoadingModal('📷 التقاط المنطقة...');
    await ocrViaScreenshot(modal, x, y, w, h);
  }

  async function ocrViaScreenshot(modal, x, y, w, h) {
    try {
      updateModalStatus(modal, '📷 التقاط الشاشة...');
      const result = await msgTimeout({ type: 'CAPTURE_TAB' }, 8000);
      if (!result || !result.success) {
        throw new Error(result ? result.error : 'فشل الالتقاط');
      }

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = result.dataUrl;
      });

      const dpr = window.devicePixelRatio || 1;
      const srcX = Math.round(x * dpr);
      const srcY = Math.round(y * dpr);
      const srcW = Math.round(w * dpr);
      const srcH = Math.round(h * dpr);

      // تكبير لدقة OCR أفضل
      const targetW = Math.max(srcW, 900);
      const scale = targetW / Math.max(srcW, 1);
      const targetH = Math.round(srcH * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
      preprocessCanvas(ctx, targetW, targetH);

      updateModalStatus(modal, '⚙️ تحليل النص...');
      const text = await runOCR(canvas);
      await finishOCR(modal, text);
    } catch (err) {
      updateModalError(modal, 'فشل: ' + err.message);
    }
  }

  // ============================================================
  // معالجة الصورة (قص + تحسين التباين)
  // ============================================================
  function preprocessCanvas(ctx, w, h) {
    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray =
          0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
        data[i] = enhanced;
        data[i + 1] = enhanced;
        data[i + 2] = enhanced;
      }
      ctx.putImageData(imageData, 0, 0);
    } catch (_) {}
  }

  function cropAroundClick(image, el, clickX, clickY) {
    const rect = el.getBoundingClientRect();
    const natW = image.naturalWidth || image.width || rect.width;
    const natH = image.naturalHeight || image.height || rect.height;

    const scaleX = natW / Math.max(rect.width, 1);
    const scaleY = natH / Math.max(rect.height, 1);
    const cx = (clickX - rect.left) * scaleX;
    const cy = (clickY - rect.top) * scaleY;

    const cropW = Math.min(Math.round(500 * scaleX), natW);
    const cropH = Math.min(Math.round(350 * scaleY), natH);
    const cropX = Math.max(
      0,
      Math.min(Math.round(cx - cropW / 2), natW - cropW)
    );
    const cropY = Math.max(
      0,
      Math.min(Math.round(cy - cropH / 2), natH - cropH)
    );

    const targetW = Math.max(cropW, 900);
    const targetH = Math.round((cropH / Math.max(cropW, 1)) * targetW);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
    preprocessCanvas(ctx, targetW, targetH);
    return canvas;
  }

  // ============================================================
  // محرك OCR مع إدارة تحميل Tesseract
  // ============================================================
  async function ensureTesseract() {
    if (window.Tesseract && tesseractState === 'ready') return;

    if (tesseractState === 'loading') {
      // انتظر حتى يكتمل التحميل
      await new Promise((resolve, reject) => {
        const started = Date.now();
        const check = setInterval(() => {
          if (tesseractState === 'ready') {
            clearInterval(check);
            resolve();
          }
          if (tesseractState === 'failed') {
            clearInterval(check);
            reject(new Error('Tesseract فشل في التحميل'));
          }
          if (Date.now() - started > 30000) {
            clearInterval(check);
            reject(new Error('Tesseract تجاوز الوقت المحدد'));
          }
        }, 200);
      });
      return;
    }

    if (tesseractState === 'failed') {
      throw new Error('Tesseract غير متاح — تحقق من الاتصال بالإنترنت');
    }

    tesseractState = 'loading';
    try {
      await loadScript(
        'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
      );
      if (!window.Tesseract) throw new Error('Tesseract لم يُحمَّل بشكل صحيح');
      tesseractState = 'ready';
    } catch (e) {
      tesseractState = 'failed';
      throw e;
    }
  }

  async function runOCR(canvas) {
    await ensureTesseract();
    const { data } = await window.Tesseract.recognize(canvas, 'eng', {
      logger: function () {},
      tessedit_pageseg_mode: '11', // نص متفرق: مثالي للمانغا والصور المختلطة
      preserve_interword_spaces: '1',
    });
    return data.text || '';
  }

  async function finishOCR(modal, rawText) {
    const cleaned = rawText
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleaned || cleaned.length < 2) {
      updateModalError(modal, 'لم يُعثر على نص. جرّب تحديد منطقة أوضح أو أكبر بـ Alt+S.');
      return;
    }

    if (!isLikelyEnglish(cleaned)) {
      updateModalError(
        modal,
        'النص المستخرج: "' + cleaned.slice(0, 100) + '" — ليس إنجليزياً.'
      );
      return;
    }

    updateModalStatus(modal, '🌐 جاري الترجمة...');
    const result = await msgTimeout({ type: 'TRANSLATE', text: cleaned }, 10000);

    if (!result || !result.success) {
      updateModalError(
        modal,
        'تعذّرت الترجمة: ' + (result ? result.error : 'خطأ غير معروف')
      );
      return;
    }

    updateModalResult(modal, cleaned, result.arabic, result.meaning);
  }

  // ============================================================
  // استخراج الكلمة تحت المؤشر
  // ============================================================
  function getWordAtPoint(x, y) {
    let range = null;

    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range) return null;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent || '';
    let s = range.startOffset;
    let e = s;
    while (s > 0 && /[a-zA-Z'\-]/.test(text[s - 1])) s--;
    while (e < text.length && /[a-zA-Z'\-]/.test(text[e])) e++;
    if (s === e) return null;

    const word = text
      .slice(s, e)
      .replace(/^['\-.]+|['\-.]+$/g, '')
      .trim();
    return word.length >= 2 ? word : null;
  }

  // ============================================================
  // نافذة الترجمة
  // ============================================================
  function buildTranslationPopup(english, arabic, meaning, loading) {
    const existing = document.getElementById('kw-popup');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'kw-popup';
    el.dataset.text = english;
    el.innerHTML =
      '<div class="kw-header">' +
      '<span class="kw-logo">kingnwaf</span>' +
      '<button class="kw-close" aria-label="إغلاق">✕</button>' +
      '</div>' +
      '<div class="kw-body">' +
      '<div class="kw-original">' + esc(english) + '</div>' +
      (loading
        ? '<div class="kw-loading"><span class="kw-spinner-sm"></span> جاري الترجمة...</div>'
        : '<div class="kw-arabic">' + esc(arabic || '') + '</div>' +
          (meaning && meaning !== arabic
            ? '<div class="kw-meaning">' + esc(meaning) + '</div>'
            : '')) +
      '</div>' +
      '<div class="kw-actions"' + (loading ? ' style="display:none"' : '') + '>' +
      '<button class="kw-btn kw-save">💾 حفظ</button>' +
      '<button class="kw-btn kw-cancel">إغلاق</button>' +
      '</div>';

    el.querySelector('.kw-close').addEventListener('click', removePopup);
    el.querySelector('.kw-cancel').addEventListener('click', removePopup);
    el.querySelector('.kw-save').addEventListener('click', function () {
      const ar = el.querySelector('.kw-arabic');
      const mn = el.querySelector('.kw-meaning');
      saveWord(
        english,
        ar ? ar.textContent : '',
        mn ? mn.textContent : '',
        getPageContext(english)
      );
    });

    return el;
  }

  function updateTranslationResult(el, arabic, meaning) {
    const english = el.dataset.text;
    const body = el.querySelector('.kw-body');
    body.innerHTML =
      '<div class="kw-original">' + esc(english) + '</div>' +
      '<div class="kw-arabic">' + esc(arabic) + '</div>' +
      (meaning && meaning !== arabic
        ? '<div class="kw-meaning">' + esc(meaning) + '</div>'
        : '');

    const actions = el.querySelector('.kw-actions');
    if (actions) actions.style.display = 'flex';

    // أعد ربط زر الحفظ
    const saveBtn = el.querySelector('.kw-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        saveWord(english, arabic, meaning, getPageContext(english));
      };
    }
  }

  function updateTranslationError(el, msg2) {
    const body = el.querySelector('.kw-body');
    body.innerHTML =
      '<div class="kw-original">' + esc(el.dataset.text) + '</div>' +
      '<div class="kw-error-msg">' + esc(msg2) + '</div>';
    const actions = el.querySelector('.kw-actions');
    if (actions) actions.style.display = 'none';
  }

  function placePopup(el, e) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = e ? e.clientX : vw / 2;
    const cy = e ? e.clientY : 60;

    let left = cx + sx;
    let top = cy + sy + 18;

    if (left + 300 > vw + sx) left = vw + sx - 308;
    if (left < sx + 4) left = sx + 4;
    if (top + 160 > vh + sy) top = cy + sy - 170;

    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function removePopup() {
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  // ============================================================
  // نوافذ OCR
  // ============================================================
  function buildLoadingModal(status) {
    const existing = document.getElementById('kw-ocr-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'kw-ocr-modal';
    document.body.appendChild(modal);
    updateModalStatus(modal, status);
    return modal;
  }

  function updateModalStatus(modal, status) {
    if (!modal || !modal.isConnected) return;
    modal.innerHTML =
      '<div class="kw-ocr-box">' +
      '<div class="kw-header">' +
      '<span class="kw-logo">kingnwaf · OCR</span>' +
      '<button class="kw-close" id="kw-ocr-x">✕</button>' +
      '</div>' +
      '<div class="kw-ocr-status">' +
      '<div class="kw-spinner"></div>' +
      '<span>' + esc(status) + '</span>' +
      '</div>' +
      '</div>';
    const x = modal.querySelector('#kw-ocr-x');
    if (x) x.addEventListener('click', function () { modal.remove(); });
  }

  function updateModalError(modal, msg2) {
    if (!modal || !modal.isConnected) return;
    modal.innerHTML =
      '<div class="kw-ocr-box">' +
      '<div class="kw-header">' +
      '<span class="kw-logo">kingnwaf · OCR</span>' +
      '<button class="kw-close" id="kw-ocr-x">✕</button>' +
      '</div>' +
      '<div class="kw-ocr-status">' +
      '<span class="kw-error-msg">' + esc(msg2) + '</span>' +
      '</div>' +
      '</div>';
    const x = modal.querySelector('#kw-ocr-x');
    if (x) x.addEventListener('click', function () { modal.remove(); });
  }

  function updateModalResult(modal, english, arabic, meaning) {
    if (!modal || !modal.isConnected) return;
    modal.innerHTML =
      '<div class="kw-ocr-box">' +
      '<div class="kw-header">' +
      '<span class="kw-logo">kingnwaf · OCR</span>' +
      '<button class="kw-close" id="kw-ocr-x">✕</button>' +
      '</div>' +
      '<div class="kw-ocr-content">' +
      '<div class="kw-ocr-label">النص المستخرج</div>' +
      '<div class="kw-original">' + esc(english) + '</div>' +
      '<div class="kw-ocr-label">الترجمة العربية</div>' +
      '<div class="kw-arabic">' + esc(arabic) + '</div>' +
      (meaning && meaning !== arabic
        ? '<div class="kw-meaning">' + esc(meaning) + '</div>'
        : '') +
      '</div>' +
      '<div class="kw-actions">' +
      '<button class="kw-btn kw-save" id="kw-ocr-save">💾 حفظ</button>' +
      '<button class="kw-btn kw-cancel" id="kw-ocr-cls">إغلاق</button>' +
      '</div>' +
      '</div>';

    modal.querySelector('#kw-ocr-x').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('#kw-ocr-cls').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('#kw-ocr-save').addEventListener('click', function () {
      saveWord(english, arabic, meaning, english);
      modal.remove();
    });
  }

  // ============================================================
  // حفظ الكلمة مع السياق الكامل
  // ============================================================
  async function saveWord(english, arabic, meaning, context) {
    if (!english || !arabic) return;
    try {
      const s = await chrome.storage.local.get('kw_vocabulary');
      const words = s.kw_vocabulary || [];
      const exists = words.find(
        (w) => w.english.toLowerCase() === english.toLowerCase()
      );

      if (!exists) {
        words.unshift({
          id: Date.now().toString(),
          english: english.trim(),
          arabic: arabic.trim(),
          meaning: (meaning || arabic).trim(),
          context: context || '',
          sourceUrl: window.location.href,
          sourceName: document.title || window.location.hostname,
          timestamp: Date.now(),
          updatedAt: Date.now(),
          mastered: false,
          status: 'new',
          reviewCount: 0,
          nextReview: Date.now(),
        });

        const st = (await chrome.storage.local.get('kw_stats')).kw_stats || {};
        st.totalCards = words.length;
        await chrome.storage.local.set({ kw_vocabulary: words, kw_stats: st });
        savedWords = words;
      }

      // تحديث زر الحفظ
      const btn =
        document.getElementById('kw-ocr-save') ||
        (popup ? popup.querySelector('.kw-save') : null);
      if (btn) {
        btn.textContent = '✓ تم الحفظ';
        btn.style.background = '#16a34a';
        btn.disabled = true;
      }

      if (settings.wordColoring) applyWordColoring();
    } catch (err) {
      console.error('kingnwaf: خطأ في الحفظ:', err);
    }
  }

  // جمع السياق المحيط بالكلمة
  function getPageContext(word) {
    try {
      const sel = window.getSelection();
      if (sel && sel.toString().includes(word)) {
        return sel.toString().trim().slice(0, 200);
      }

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
      );
      const rx = new RegExp('\\b' + escRx(word) + '\\b', 'i');
      let node;
      while ((node = walker.nextNode())) {
        if (rx.test(node.textContent)) {
          return node.textContent.trim().slice(0, 200);
        }
      }
    } catch (_) {}
    return '';
  }

  // ============================================================
  // تلوين الكلمات المحفوظة
  // ============================================================
  function applyWordColoring() {
    removeWordColoring();
    if (!savedWords.length) return;
    const pattern = savedWords
      .map((w) => escRx(w.english.toLowerCase()))
      .join('|');
    if (!pattern) return;
    const rx = new RegExp('\\b(' + pattern + ')\\b', 'gi');

    getTextNodes(document.body).forEach((node) => {
      if (!rx.test(node.textContent)) return;
      rx.lastIndex = 0;
      const span = document.createElement('span');
      span.className = 'kw-colored-span';
      span.innerHTML = node.textContent.replace(
        rx,
        '<mark class="kw-highlight">$1</mark>'
      );
      if (node.parentNode) node.parentNode.replaceChild(span, node);
    });
  }

  function removeWordColoring() {
    document.querySelectorAll('.kw-colored-span').forEach((s) => {
      if (s.parentNode)
        s.parentNode.replaceChild(
          document.createTextNode(s.textContent),
          s
        );
    });
  }

  function getTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const t = p.tagName.toLowerCase();
        if (['script', 'style', 'noscript'].includes(t))
          return NodeFilter.FILTER_REJECT;
        if (p.closest('#kw-popup,#kw-ocr-modal,#kw-ocr-overlay'))
          return NodeFilter.FILTER_REJECT;
        if (!n.textContent || n.textContent.trim().length < 2)
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // ============================================================
  // أدوات مساعدة
  // ============================================================
  function isLikelyEnglish(text) {
    const t = text ? text.trim() : '';
    if (!t || t.length < 2) return false;
    if (/[\u0600-\u06FF]/.test(t)) return false; // عربي
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF]/.test(t)) return false; // CJK/ياباني
    if (!/[a-zA-Z]/.test(t)) return false; // لا يوجد حرف لاتيني
    if (/^[\d\s\W]+$/.test(t)) return false; // أرقام ورموز فقط
    const letters = (t.match(/[a-zA-Z]/g) || []).length;
    return letters >= 2;
  }

  function esc(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escRx(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('فشل تحميل: ' + src));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }
})();
