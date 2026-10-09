(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.lib = CA.lib || {};

  var PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var loadPromise = null;

  function loadPdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      var existing = root.document.querySelector('script[data-ca-pdfjs]');
      if (existing) {
        existing.addEventListener('load', function () {
          if (root.pdfjsLib) resolve(root.pdfjsLib);
          else reject(new Error('PDF 读取库加载后不可用'));
        });
        existing.addEventListener('error', function () {
          reject(new Error('PDF 读取库加载失败'));
        });
        return;
      }
      var script = root.document.createElement('script');
      script.src = PDFJS_CDN;
      script.async = true;
      script.setAttribute('data-ca-pdfjs', '1');
      script.onload = function () {
        if (root.pdfjsLib) resolve(root.pdfjsLib);
        else reject(new Error('PDF 读取库加载后不可用'));
      };
      script.onerror = function () {
        if (root.__caAssetFailures && root.__caAssetFailures.indexOf('PDF 文字读取库') < 0) {
          root.__caAssetFailures.push('PDF 文字读取库');
        }
        if (root.CareerAgent && root.CareerAgent.onAssetFailure) {
          root.CareerAgent.onAssetFailure('PDF 文字读取库');
        }
        reject(new Error('PDF 读取库加载失败，可改为手动粘贴正文'));
      };
      root.document.head.appendChild(script);
    }).then(
      function (lib) {
        return lib;
      },
      function (err) {
        loadPromise = null;
        throw err;
      }
    );
    return loadPromise;
  }

  function joinPageText(items) {
    var parts = [];
    var lastY = null;
    items.forEach(function (item) {
      var y = item.transform && item.transform.length > 5 ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) parts.push('\n');
      else if (parts.length && !/\s$/.test(parts[parts.length - 1]) && item.str && !/^\s/.test(item.str)) {
        parts.push(' ');
      }
      parts.push(item.str || '');
      if (y !== null) lastY = y;
    });
    return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * 尝试从 PDF 二进制抽出文字。失败时 reject，不编造内容。
   * @returns {Promise<{text:string, pageCount:number}>}
   */
  function extractTextFromPdf(arrayBuffer) {
    if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer) && !(arrayBuffer.buffer instanceof ArrayBuffer)) {
      return Promise.reject(new Error('没有可读取的 PDF 数据'));
    }
    var data = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer;
    return loadPdfJs().then(function (pdfjsLib) {
      // file:// 下 Worker 常不可用；关闭 Worker 用主线程解析。
      var loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(data),
        disableWorker: true,
        useSystemFonts: true,
        isEvalSupported: false
      });
      return loadingTask.promise.then(function (pdf) {
        var pageCount = pdf.numPages || 0;
        if (!pageCount) return { text: '', pageCount: 0 };
        var texts = [];
        var index = 1;
        function nextPage() {
          if (index > pageCount) {
            return { text: texts.filter(Boolean).join('\n\n').trim(), pageCount: pageCount };
          }
          return pdf.getPage(index).then(function (page) {
            return page.getTextContent().then(function (content) {
              texts.push(joinPageText(content.items || []));
              index += 1;
              return nextPage();
            });
          });
        }
        return nextPage();
      });
    });
  }

  CA.lib.pdfText = {
    extractTextFromPdf: extractTextFromPdf,
    loadPdfJs: loadPdfJs
  };
})(window);
