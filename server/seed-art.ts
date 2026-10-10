// Development listings have no real photos. Instead of a grey placeholder, each seed listing gets a set of
// studio-style illustrations of its device: front, back, screen on, the IMEI or serial screen, and the box.
// Keys look like seed/<listing>/<shot>, matching scripts/seed.mjs. IMEIs and serials stay masked, as on the
// listing page, where they are shown only after payment.

type Kind = "phone" | "laptop";
interface Device {
  kind: Kind;
  backdrop: [string, string];
  finish: [string, string];
  screen: [string, string, string];
  camera?: "dual-diagonal" | "dual-vertical" | "triple-contour";
  front?: "notch" | "wide-notch" | "punch";
  masked: string;
}

const DEVICES: Record<number, Device> = {
  1: { kind: "phone", backdrop: ["#f7e6e8", "#ecd2d6"], finish: ["#f6d3d8", "#e9b8c0"], screen: ["#ff9a8b", "#ff6a88", "#7b4397"], camera: "dual-diagonal", front: "notch", masked: "35 291811 ••••• 31" },
  2: { kind: "laptop", backdrop: ["#e7edf3", "#d3dde7"], finish: ["#d9dee3", "#b7bec6"], screen: ["#2b5876", "#4e4376", "#1a2a6c"], masked: "5CG8••••QZ" },
  3: { kind: "phone", backdrop: ["#ebe7f3", "#d9d2ea"], finish: ["#a598cf", "#7d6fb2"], screen: ["#4facfe", "#8e78ff", "#2b1055"], camera: "triple-contour", front: "punch", masked: "35 123456 ••••• 23" },
  4: { kind: "laptop", backdrop: ["#f3ece1", "#e7dac6"], finish: ["#efdcc4", "#d6bc9b"], screen: ["#f7971e", "#ffd200", "#c94b4b"], masked: "FVFG••••6L4" },
  5: { kind: "phone", backdrop: ["#e3f2ea", "#cbe5d7"], finish: ["#d8ccef", "#b9a8de"], screen: ["#43cea2", "#185a9d", "#0f2027"], camera: "dual-vertical", front: "wide-notch", masked: "35 678901 ••••• 70" },
  6: { kind: "laptop", backdrop: ["#e4e7ea", "#cfd4d9"], finish: ["#3a3f45", "#22262a"], screen: ["#11998e", "#38ef7d", "#0b3d32"], masked: "7490••••X" },
};

const PHONE_SHOTS = ["Front", "Back", "Screen on", "IMEI screen (*#06#)", "Box and cable"];
const LAPTOP_SHOTS = ["Front", "Lid", "Screen on", "Serial number", "Charger"];

const FONT = `font-family="Figtree, system-ui, -apple-system, Segoe UI, sans-serif"`;

function frame(d: Device, n: number, shot: number, label: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.backdrop[0]}"/><stop offset="1" stop-color="${d.backdrop[1]}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.32" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0b1f1a" stop-opacity="0.28"/><stop offset="1" stop-color="#0b1f1a" stop-opacity="0"/></radialGradient>
<linearGradient id="fin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.finish[0]}"/><stop offset="1" stop-color="${d.finish[1]}"/></linearGradient>
<linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.screen[0]}"/><stop offset="0.55" stop-color="${d.screen[1]}"/><stop offset="1" stop-color="${d.screen[2]}"/></linearGradient>
<linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="lens" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#4a5a78"/><stop offset="0.35" stop-color="#151a24"/><stop offset="1" stop-color="#05070a"/></radialGradient>
</defs>
<rect width="800" height="600" fill="url(#bg)"/>
<rect width="800" height="600" fill="url(#glow)"/>
${body}
<g transform="translate(24 548)"><rect width="${label.length * 8.2 + 44}" height="30" rx="15" fill="#ffffff" fill-opacity="0.78"/><text x="15" y="20" ${FONT} font-size="14" font-weight="600" fill="#17201d">${shot} · ${escapeXml(label)}</text></g>
<text x="776" y="568" text-anchor="end" ${FONT} font-size="12" fill="#17201d" fill-opacity="0.45">Demo listing ${n}</text>
</svg>`;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Phone, front: bezel, wallpaper, notch or punch-hole, and a lock screen or another screen inside.
function phoneFront(d: Device, inner: string, tilt = 0) {
  const cut = d.front === "punch"
    ? `<circle cx="400" cy="104" r="7" fill="#05070a"/>`
    : `<rect x="${d.front === "wide-notch" ? 346 : 356}" y="82" width="${d.front === "wide-notch" ? 108 : 88}" height="24" rx="12" fill="#05070a"/>`;
  return `<ellipse cx="400" cy="532" rx="150" ry="18" fill="url(#floor)"/>
<g transform="rotate(${tilt} 400 300)">
<rect x="284" y="62" width="232" height="468" rx="40" fill="url(#fin)"/>
<rect x="290" y="68" width="220" height="456" rx="35" fill="#0a0c0f"/>
<rect x="300" y="78" width="200" height="436" rx="27" fill="url(#scr)"/>
${inner}
${cut}
<rect x="280" y="170" width="4" height="36" rx="2" fill="${d.finish[1]}"/><rect x="280" y="216" width="4" height="36" rx="2" fill="${d.finish[1]}"/><rect x="516" y="190" width="4" height="56" rx="2" fill="${d.finish[1]}"/>
<path d="M300 105 a27 27 0 0 1 27 -27 h110 L300 360 z" fill="url(#shine)"/>
</g>`;
}

const lockScreen = `<text x="400" y="190" text-anchor="middle" ${FONT} font-size="64" font-weight="600" fill="#fff" fill-opacity="0.95">9:41</text>
<text x="400" y="138" text-anchor="middle" ${FONT} font-size="15" fill="#fff" fill-opacity="0.85">Friday 10 October</text>
<rect x="352" y="488" width="96" height="5" rx="2.5" fill="#fff" fill-opacity="0.8"/>`;

function homeScreen() {
  const colours = ["#ffffff", "#ffe08a", "#9be7c4", "#ffb4a2", "#b8c0ff", "#a0e7ff", "#ffd6e7", "#c7f9cc", "#fde68a", "#e9d5ff", "#bae6fd", "#fecaca", "#d9f99d", "#fbcfe8", "#ddd6fe", "#99f6e4"];
  let s = `<text x="326" y="112" ${FONT} font-size="13" font-weight="600" fill="#fff">9:41</text>`;
  colours.forEach((c, i) => {
    const x = 318 + (i % 4) * 44, y = 136 + Math.floor(i / 4) * 58;
    s += `<rect x="${x}" y="${y}" width="34" height="34" rx="9" fill="${c}" fill-opacity="0.9"/><rect x="${x + 6}" y="${y + 40}" width="22" height="4" rx="2" fill="#fff" fill-opacity="0.6"/>`;
  });
  s += `<rect x="310" y="442" width="180" height="56" rx="20" fill="#fff" fill-opacity="0.25"/>`;
  [0, 1, 2, 3].forEach((i) => { s += `<rect x="${322 + i * 42}" y="453" width="34" height="34" rx="9" fill="#fff" fill-opacity="0.85"/>`; });
  return s;
}

function imeiScreen(d: Device) {
  return `<rect x="300" y="78" width="200" height="436" rx="27" fill="#f4f6f5"/>
<text x="400" y="150" text-anchor="middle" ${FONT} font-size="26" font-weight="600" fill="#17201d">*#06#</text>
<rect x="314" y="220" width="172" height="120" rx="16" fill="#fff" stroke="#d5deda"/>
<text x="400" y="252" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="#17201d">IMEI</text>
<text x="400" y="284" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="15" fill="#17201d">${d.masked}</text>
<line x1="314" y1="306" x2="486" y2="306" stroke="#d5deda"/>
<text x="400" y="328" text-anchor="middle" ${FONT} font-size="14" font-weight="600" fill="#0f6e56">OK</text>`;
}

function phoneBack(d: Device) {
  let cam = "";
  const lens = (cx: number, cy: number, r = 17) => `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#0b0d10" fill-opacity="0.85"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lens)"/><circle cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" r="${r * 0.22}" fill="#fff" fill-opacity="0.35"/>`;
  if (d.camera === "triple-contour") {
    cam = `<path d="M300 92 h46 a14 14 0 0 1 14 14 v136 a14 14 0 0 1 -14 14 h-46 z" fill="${d.finish[1]}" stroke="#000" stroke-opacity="0.12"/>` + lens(326, 128, 15) + lens(326, 176, 15) + lens(326, 224, 15);
  } else {
    cam = `<rect x="302" y="92" width="96" height="104" rx="26" fill="${d.finish[0]}" stroke="#000" stroke-opacity="0.10"/><rect x="306" y="96" width="88" height="96" rx="23" fill="#fff" fill-opacity="0.18"/>`;
    cam += d.camera === "dual-diagonal" ? lens(332, 124) + lens(368, 162) : lens(332, 124) + lens(332, 164);
    cam += `<circle cx="372" cy="122" r="6" fill="#fff6d6"/>`;
  }
  return `<ellipse cx="400" cy="532" rx="150" ry="18" fill="url(#floor)"/>
<rect x="284" y="62" width="232" height="468" rx="40" fill="url(#fin)"/>
<rect x="290" y="68" width="220" height="456" rx="35" fill="none" stroke="#fff" stroke-opacity="0.35"/>
${cam}
<path d="M284 100 a40 40 0 0 1 40 -38 h150 L284 420 z" fill="url(#shine)"/>`;
}

function boxAndCable(d: Device) {
  return `<ellipse cx="370" cy="470" rx="190" ry="22" fill="url(#floor)"/>
<path d="M210 210 L360 160 L540 200 L390 252 Z" fill="#ffffff"/>
<path d="M210 210 L390 252 L390 460 L210 412 Z" fill="#eef1f0"/>
<path d="M390 252 L540 200 L540 404 L390 460 Z" fill="#dfe5e3"/>
<path d="M292 196 L432 228" stroke="${d.finish[1]}" stroke-width="10" stroke-linecap="round" stroke-opacity="0.8"/>
<g fill="none" stroke="#fbfbfb" stroke-width="9" stroke-linecap="round"><ellipse cx="610" cy="430" rx="70" ry="26"/><ellipse cx="610" cy="420" rx="62" ry="22"/><path d="M548 430 C500 470 470 480 430 500"/></g>
<rect x="414" y="490" width="30" height="16" rx="5" fill="#e3e6e5" transform="rotate(-18 429 498)"/>`;
}

function laptopFront(d: Device, inner: string, scale = 1) {
  return `<ellipse cx="400" cy="470" rx="${280 * scale}" ry="20" fill="url(#floor)"/>
<g transform="translate(400 300) scale(${scale}) translate(-400 -300)">
<rect x="170" y="96" width="460" height="300" rx="18" fill="#0a0c0f"/>
<rect x="180" y="106" width="440" height="276" rx="10" fill="url(#scr)"/>
${inner}
<circle cx="400" cy="101" r="2.5" fill="#2a2f36"/>
<path d="M120 396 h560 v10 a14 14 0 0 1 -14 14 h-532 a14 14 0 0 1 -14 -14 z" fill="url(#fin)"/>
<rect x="352" y="396" width="96" height="7" rx="3.5" fill="#000" fill-opacity="0.16"/>
<path d="M180 106 h160 L180 300 z" fill="url(#shine)"/>
</g>`;
}

const desktop = `<rect x="214" y="134" width="210" height="140" rx="10" fill="#fff" fill-opacity="0.92"/><rect x="214" y="134" width="210" height="22" rx="10" fill="#eef1f0"/><circle cx="228" cy="145" r="4" fill="#ff6159"/><circle cx="242" cy="145" r="4" fill="#ffbd2e"/><circle cx="256" cy="145" r="4" fill="#28c941"/>
<rect x="230" y="172" width="120" height="8" rx="4" fill="#17201d" fill-opacity="0.75"/><rect x="230" y="190" width="170" height="6" rx="3" fill="#17201d" fill-opacity="0.25"/><rect x="230" y="204" width="150" height="6" rx="3" fill="#17201d" fill-opacity="0.25"/><rect x="230" y="226" width="80" height="26" rx="8" fill="#0f6e56"/>
<rect x="446" y="176" width="146" height="168" rx="10" fill="#fff" fill-opacity="0.85"/><rect x="460" y="192" width="118" height="70" rx="6" fill="url(#scr)"/><rect x="460" y="274" width="90" height="7" rx="3.5" fill="#17201d" fill-opacity="0.6"/><rect x="460" y="290" width="110" height="6" rx="3" fill="#17201d" fill-opacity="0.25"/>
<rect x="320" y="352" width="160" height="22" rx="8" fill="#fff" fill-opacity="0.35"/>`;

function laptopLid(d: Device) {
  return `<ellipse cx="400" cy="480" rx="270" ry="22" fill="url(#floor)"/>
<g transform="translate(400 300) skewX(-6) translate(-400 -300)">
<rect x="150" y="120" width="500" height="330" rx="22" fill="url(#fin)"/>
<rect x="156" y="126" width="488" height="318" rx="18" fill="none" stroke="#fff" stroke-opacity="0.35"/>
<circle cx="400" cy="285" r="26" fill="#fff" fill-opacity="0.12"/>
<path d="M150 150 a22 22 0 0 1 22 -30 h200 L150 380 z" fill="url(#shine)"/>
</g>`;
}

function serialLabel(d: Device) {
  let bars = "";
  for (let i = 0; i < 46; i++) bars += `<rect x="${292 + i * 4.6}" y="356" width="${i % 3 === 0 ? 2.6 : 1.4}" height="44" fill="#17201d"/>`;
  return `<rect x="90" y="90" width="620" height="420" rx="34" fill="url(#fin)"/>
<rect x="130" y="128" width="160" height="16" rx="8" fill="#000" fill-opacity="0.35"/><rect x="510" y="128" width="160" height="16" rx="8" fill="#000" fill-opacity="0.35"/>
<rect x="130" y="456" width="160" height="16" rx="8" fill="#000" fill-opacity="0.35"/><rect x="510" y="456" width="160" height="16" rx="8" fill="#000" fill-opacity="0.35"/>
<rect x="270" y="214" width="260" height="206" rx="12" fill="#fbfbf8" stroke="#000" stroke-opacity="0.08"/>
<text x="292" y="252" ${FONT} font-size="15" font-weight="600" fill="#17201d">Serial number (S/N)</text>
<text x="292" y="290" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="20" fill="#17201d">${d.masked}</text>
<text x="292" y="328" ${FONT} font-size="12" fill="#56625e">Check it matches at the hand-over</text>
${bars}`;
}

function charger(d: Device) {
  return `<ellipse cx="400" cy="440" rx="220" ry="22" fill="url(#floor)"/>
<rect x="250" y="250" width="170" height="170" rx="28" fill="${d.finish[1] === "#22262a" ? "#2b2f33" : "#fafafa"}"/>
<rect x="258" y="258" width="154" height="154" rx="22" fill="none" stroke="#000" stroke-opacity="0.06"/>
<g fill="none" stroke="${d.finish[1] === "#22262a" ? "#2b2f33" : "#f4f4f4"}" stroke-width="10" stroke-linecap="round"><path d="M420 335 C520 320 560 260 520 220 C480 180 430 230 470 270 C510 310 600 300 610 380"/></g>
<rect x="596" y="378" width="28" height="44" rx="6" fill="#d9dcdb"/>`;
}

export function seedArt(key: string): string {
  const [, listing, shot] = key.split("/");
  const n = Number(listing) || 1;
  const i = Number(shot) || 1;
  const d = DEVICES[((n - 1) % 6) + 1];
  const label = (d.kind === "phone" ? PHONE_SHOTS : LAPTOP_SHOTS)[(i - 1) % 5];
  let body: string;
  if (d.kind === "phone") {
    body = i === 1 ? phoneFront(d, lockScreen) : i === 2 ? phoneBack(d) : i === 3 ? phoneFront(d, homeScreen(), -8) : i === 4 ? phoneFront(d, imeiScreen(d)) : boxAndCable(d);
  } else {
    body = i === 1 ? laptopFront(d, "") : i === 2 ? laptopLid(d) : i === 3 ? laptopFront(d, desktop, 1.12) : i === 4 ? serialLabel(d) : charger(d);
  }
  return frame(d, n, i, label, body);
}
