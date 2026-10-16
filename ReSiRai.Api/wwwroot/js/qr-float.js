// ReSiRai — کیو‌آرِ شناورِ همیشه‌حاضر (طرحِ دایره‌ای)
//
// یک دایرهٔ کوچک در گوشهٔ چپ-پایین؛ با بردنِ موس کامل می‌شود و کدِ قابلِ اسکن
// نشان داده می‌شود. این ماژول به چرخهٔ صفحهٔ ورود گره نخورده: هم روی صفحهٔ
// ورود و هم داخلِ برنامه دیده می‌شود (مثلِ فیش‌دستمزد).
(() => {
  "use strict";

  function build() {
    if (document.getElementById("resiraiQrFloat")) return; // یک بار
    if (typeof window.qrcode !== "function") return;        // qrcode.js هنوز نه
    var box = document.createElement("div");
    box.id = "resiraiQrFloat";
    box.setAttribute("tabindex", "0");
    box.title = "برای اتصال موبایل، نشانگر را روی دایره ببرید";
    var inner = document.createElement("div");
    inner.className = "resirai-qr-canvas";
    var cap = document.createElement("div");
    cap.className = "resirai-qr-cap";
    cap.innerHTML = "برای اتصال موبایل<br>این کد را اسکن کنید";
    box.append(inner, cap);
    document.documentElement.appendChild(box);

    try {
      var q = window.qrcode(0, "M");
      q.addData(window.location.origin + "/");
      q.make();
      inner.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (_) { /* بی‌اثر */ }
  }

  function ensureCss() {
    if (document.getElementById("resiraiQrFloatCss")) return;
    var s = document.createElement("style");
    s.id = "resiraiQrFloatCss";
    s.textContent =
      "#resiraiQrFloat{position:fixed;left:18px;bottom:18px;right:auto;top:auto;z-index:10050;" +
      "background:#fff;border-radius:50%;padding:7px;width:64px;height:64px;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;" +
      "box-shadow:0 8px 22px rgba(8,50,80,.28);cursor:zoom-in;" +
      "transition:width .18s ease,height .18s ease,border-radius .18s ease,box-shadow .18s ease;box-sizing:content-box}" +
      "#resiraiQrFloat:hover,#resiraiQrFloat:focus-within{width:200px;height:auto;border-radius:16px;" +
      "padding:10px 10px 6px;cursor:zoom-out;box-shadow:0 14px 40px rgba(8,50,80,.32)}" +
      "#resiraiQrFloat .resirai-qr-canvas{width:50px;height:50px;flex:0 0 auto;transition:width .18s ease,height .18s ease}" +
      "#resiraiQrFloat:hover .resirai-qr-canvas,#resiraiQrFloat:focus-within .resirai-qr-canvas{width:178px;height:178px}" +
      "#resiraiQrFloat .resirai-qr-canvas svg{width:100%;height:100%;display:block}" +
      "#resiraiQrFloat .resirai-qr-cap{display:none;font-size:10.5px;line-height:1.7;color:#0b3d4f;margin-top:4px;text-align:center}" +
      "#resiraiQrFloat:hover .resirai-qr-cap,#resiraiQrFloat:focus-within .resirai-qr-cap{display:block}";
    document.head.appendChild(s);
  }

  function start() {
    ensureCss();
    build();
    // اگر qrcode.js دیرتر برسد (صفحه‌های سنگین)، دوباره تلاش کن
    if (!document.getElementById("resiraiQrFloat")) {
      var tries = 0;
      var t = setInterval(function () {
        tries += 1;
        build();
        if (document.getElementById("resiraiQrFloat") || tries > 40) clearInterval(t);
      }, 250);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
