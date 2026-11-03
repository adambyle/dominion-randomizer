// The join code for a locked room: a QR code that opens the room's table on its rules.

import qrcode from "qrcode-generator";
import { h, icon } from "../dom";
import type { App } from "../main";

/** Link that joins the room and, when its table is locked, opens the rules reference. */
export function joinLink(code: string) {
  return `${location.origin}${location.pathname}#/room/${code}/rules`;
}

/** An inline SVG QR code. */
export function qrSvg(text: string): SVGElement {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const wrap = document.createElement("div");
  wrap.innerHTML = qr.createSvgTag({ cellSize: 1, margin: 2, scalable: true });
  const svg = wrap.firstElementChild as SVGElement;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code to join the room");
  return svg;
}

let copied = false;

export function qrView(app: App): HTMLElement {
  const code = app.room.code!;
  const link = joinLink(code);
  return h("div.qr-dialog", { role: "dialog", "aria-modal": "true", "aria-label": "Join this table" },
    h("button.icon-btn.qr-close", { type: "button", "aria-label": "Close", onclick: () => app.closeQr() }, icon("close")),
    h("h2", null, "Join this table"),
    h("p.muted", null, "Scan to join the room and open the cards’ rules."),
    h("div.qr-code", null, qrSvg(link)),
    h("p.qr-room", null, "Room ", h("b", null, code)),
    h("button.btn", { type: "button", onclick: async () => {
      try { await navigator.clipboard.writeText(link); copied = true; app.render(); setTimeout(() => { copied = false; app.render(); }, 2000); } catch { prompt("Copy this link", link); }
    } }, icon("check"), copied ? "Copied" : "Copy link"));
}
