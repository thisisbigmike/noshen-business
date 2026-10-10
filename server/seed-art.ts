// Development listings have no real photos. Instead of a grey placeholder, each seed listing gets a set of
// studio-style illustrations of the item: phones and laptops, sneakers, a dress, a car, a sofa, a console.
// Keys look like seed/<listing>/<shot>, matching scripts/seed.mjs. IMEIs and serials stay masked, as on the
// listing page, where they are shown only after payment.

type Kind = "phone" | "laptop" | "shoe" | "dress" | "car" | "sofa" | "console" | "wig" | "perfume";
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
  7: { kind: "shoe", backdrop: ["#eef0f3", "#d9dfe6"], finish: ["#ffffff", "#e6e6e1"], screen: ["#1b6f6a", "#14b8a6", "#0b3d32"], masked: "" },
  8: { kind: "dress", backdrop: ["#f6ede4", "#e9d8c3"], finish: ["#e8572a", "#c8461f"], screen: ["#f6c343", "#1b6f6a", "#3b2a6b"], masked: "" },
  9: { kind: "car", backdrop: ["#e6edf2", "#d0dbe5"], finish: ["#4a6a9b", "#22385a"], screen: ["#9fb3cc", "#5b7398", "#22385a"], masked: "2T1B•••••••••3456" },
  10: { kind: "sofa", backdrop: ["#f1ece4", "#e1d6c6"], finish: ["#a3abb2", "#7f8890"], screen: ["#c9ced3", "#9aa3ab", "#5b646c"], masked: "" },
  11: { kind: "console", backdrop: ["#e9ecf5", "#d3d9ea"], finish: ["#fafaf8", "#e4e5e2"], screen: ["#2b5bd7", "#0a1f6b", "#05103a"], masked: "E7••••••21" },
  12: { kind: "wig", backdrop: ["#f4e9ef", "#e6d2dd"], finish: ["#2a1d17", "#120c09"], screen: ["#e9c9b0", "#d9b394", "#b98d6c"], masked: "" },
  13: { kind: "perfume", backdrop: ["#eef1f6", "#d7dde8"], finish: ["#3d5a80", "#1d2d44"], screen: ["#c9d6e8", "#9fb1c9", "#2b3a55"], masked: "" },
};

const SHOTS: Record<Kind, string[]> = {
  phone: ["Front", "Back", "Screen on", "IMEI screen (*#06#)", "Box and cable"],
  laptop: ["Front", "Lid", "Screen on", "Serial number", "Charger"],
  shoe: ["Side", "Other side", "Close-up", "Size label", "Box"],
  dress: ["Front", "Back", "Fabric close-up", "Size label", "Full length"],
  car: ["Side", "Other side", "Dashboard", "Papers (name covered)", "Wheel and tyre"],
  sofa: ["Front", "Angle", "Fabric close-up", "Care label", "Size"],
  console: ["Front", "Back", "Switched on", "Serial number", "Pads and cables"],
  wig: ["Front", "Side", "Close-up", "Lace and cap", "Length"],
  perfume: ["Front", "Back", "Box", "Batch code", "Sealed cap"],
};


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


// ---------------------------------------------------------------- More than phones and laptops

const mirror = (g: string) => `<g transform="translate(800 0) scale(-1 1)">${g}</g>`;
const zoom = (g: string, fx: number, fy: number, z: number) => `<g transform="translate(400 300) scale(${z}) translate(${-fx} ${-fy})">${g}</g>`;

/** A white label or tag, the way it would be photographed close up. */
function tagCard(title: string, big: string, lines: string[], tilt = -3) {
  return `<g transform="rotate(${tilt} 400 300)">
<rect x="250" y="150" width="300" height="300" rx="18" fill="#000" fill-opacity="0.08" transform="translate(6 10)"/>
<rect x="250" y="150" width="300" height="300" rx="18" fill="#fbfbf8" stroke="#000" stroke-opacity="0.08"/>
<circle cx="400" cy="176" r="7" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="2"/>
<text x="400" y="222" text-anchor="middle" ${FONT} font-size="16" font-weight="600" fill="#56625e">${escapeXml(title)}</text>
<text x="400" y="300" text-anchor="middle" ${FONT} font-size="64" font-weight="700" fill="#17201d">${escapeXml(big)}</text>
${lines.map((l, i) => `<text x="400" y="${348 + i * 26}" text-anchor="middle" ${FONT} font-size="15" fill="#56625e">${escapeXml(l)}</text>`).join("")}
</g>`;
}

function sneaker(d: Device) {
  let laces = "";
  for (let k = 0; k < 5; k++) laces += `<path d="M${326 + k * 17} ${258 + k * 8} l14 14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  return `<ellipse cx="410" cy="426" rx="236" ry="16" fill="url(#floor)"/>
<path d="M196 372 C192 404 206 414 236 414 L592 414 C626 414 636 398 628 378 L622 366 Z" fill="#fff" stroke="#000" stroke-opacity="0.12" stroke-width="2"/>
<path d="M202 398 L630 398" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
<path d="M204 372 L206 300 C207 276 222 262 246 260 L300 256 C318 244 344 242 362 256 L404 292 C440 312 500 324 560 334 C602 342 624 356 626 372 Z" fill="url(#fin)" stroke="#000" stroke-opacity="0.10" stroke-width="2"/>
<path d="M300 256 C304 234 330 226 348 240 L362 256 Z" fill="url(#fin)" stroke="#000" stroke-opacity="0.10" stroke-width="2"/>
<path d="M206 302 C232 302 252 322 258 372" fill="none" stroke="#000" stroke-opacity="0.10" stroke-width="3"/>
<path d="M520 330 C542 346 560 360 566 372" fill="none" stroke="#000" stroke-opacity="0.10" stroke-width="3"/>
<path d="M286 358 C356 354 432 336 506 304 C458 338 392 364 296 370 Z" fill="${d.screen[0]}"/>
<path d="M316 262 L404 298" stroke="#000" stroke-opacity="0.10" stroke-width="12" stroke-linecap="round"/>
${laces}
<path d="M214 362 L612 362" stroke="#000" stroke-opacity="0.14" stroke-width="1.5" stroke-dasharray="5 5"/>
<path d="M206 300 C208 280 224 266 246 262 L300 258" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="3"/>`;
}

function shoeBox(d: Device) {
  return `<ellipse cx="400" cy="460" rx="220" ry="20" fill="url(#floor)"/>
<path d="M200 250 L400 196 L600 250 L400 304 Z" fill="${d.screen[0]}"/>
<path d="M200 250 L400 304 L400 440 L200 386 Z" fill="${d.screen[2]}"/>
<path d="M400 304 L600 250 L600 386 L400 440 Z" fill="${d.screen[1]}"/>
<path d="M200 250 L400 304 L600 250" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>
${sneakerSmall(d)}`;
}
const sneakerSmall = (d: Device) => `<g transform="translate(330 430) scale(0.5) translate(-410 -340)">${sneaker(d).replace(/<ellipse[^>]*\/>/, "")}</g>`;

const ankara = `<defs><pattern id="ank" width="56" height="56" patternUnits="userSpaceOnUse">
<rect width="56" height="56" fill="#e8572a"/><circle cx="28" cy="28" r="17" fill="#f6c343"/><circle cx="28" cy="28" r="10" fill="#1b6f6a"/><circle cx="28" cy="28" r="4" fill="#f6efe2"/>
<path d="M0 0 L12 0 L0 12 Z M56 0 L44 0 L56 12 Z M0 56 L12 56 L0 44 Z M56 56 L44 56 L56 44 Z" fill="#3b2a6b"/></pattern></defs>`;

const DRESS = "M360 148 L378 148 Q400 172 422 148 L440 148 L452 172 L446 250 C500 330 530 420 548 500 Q400 522 252 500 C270 420 300 330 354 250 L348 172 Z";

function dress(back = false, hanger = true) {
  const neck = back ? `<path d="M400 150 L400 250" stroke="#000" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="3 3"/>` : "";
  const hang = hanger ? `<path d="M400 112 C400 98 412 92 418 100 C424 110 412 116 400 118" fill="none" stroke="#8a8f94" stroke-width="4" stroke-linecap="round"/>
<path d="M400 118 L322 152 Q312 158 324 158 L476 158 Q488 158 478 152 Z" fill="none" stroke="#8a8f94" stroke-width="5" stroke-linejoin="round"/>` : "";
  return `${ankara}<ellipse cx="400" cy="520" rx="170" ry="12" fill="url(#floor)"/>${hang}
<path d="${DRESS}" fill="url(#ank)" stroke="#000" stroke-opacity="0.15" stroke-width="2"/>
<path d="M300 330 C330 300 350 280 356 252 M500 330 C470 300 450 280 444 252" fill="none" stroke="#000" stroke-opacity="0.10" stroke-width="10"/>
<path d="M354 250 Q400 264 446 250" fill="none" stroke="#3b2a6b" stroke-width="10" stroke-linecap="round"/>${neck}`;
}

function fabric() {
  return `${ankara}<rect width="800" height="600" fill="url(#ank)" transform="scale(2.2)"/>
<path d="M0 360 C200 300 520 420 800 330 L800 600 L0 600 Z" fill="#000" fill-opacity="0.12"/>`;
}

function car(d: Device) {
  const wheel = (cx: number) => {
    let spokes = "";
    for (let k = 0; k < 5; k++) spokes += `<path d="M${cx} 400 L${cx + 24 * Math.cos((k * 72 * Math.PI) / 180)} ${400 + 24 * Math.sin((k * 72 * Math.PI) / 180)}" stroke="#8a9096" stroke-width="7" stroke-linecap="round"/>`;
    return `<circle cx="${cx}" cy="400" r="45" fill="#16191c"/><circle cx="${cx}" cy="400" r="29" fill="#cdd2d7"/>${spokes}<circle cx="${cx}" cy="400" r="8" fill="#5b6168"/>`;
  };
  return `<ellipse cx="410" cy="444" rx="300" ry="18" fill="url(#floor)"/>
<path d="M140 372 C138 340 150 326 180 320 L262 306 C300 268 340 244 400 240 L480 240 C530 242 566 268 604 304 L650 314 C676 320 684 338 682 366 L680 384 C680 396 672 402 660 402 L150 402 C142 402 138 394 140 384 Z" fill="url(#fin)"/>
<path d="M176 402 A54 54 0 0 1 284 402 Z M530 402 A54 54 0 0 1 638 402 Z" fill="#101315"/>
<path d="M282 304 C312 272 344 258 392 256 L396 304 Z" fill="#25313c"/>
<path d="M410 256 L478 256 C514 258 540 274 566 302 L410 304 Z" fill="#25313c"/>
<path d="M300 300 C320 278 340 266 370 262 L320 300 Z M430 262 L470 262 L436 300 L420 300 Z" fill="#fff" fill-opacity="0.18"/>
<path d="M150 346 L678 352" stroke="#fff" stroke-opacity="0.3" stroke-width="2"/>
<path d="M402 306 L402 396 M546 306 L552 390 M268 312 L262 396" stroke="#000" stroke-opacity="0.22" stroke-width="2"/>
<rect x="360" y="320" width="26" height="6" rx="3" fill="#000" fill-opacity="0.3"/><rect x="510" y="320" width="26" height="6" rx="3" fill="#000" fill-opacity="0.3"/>
<path d="M590 298 L606 290 L612 304 L596 306 Z" fill="${d.finish[1]}"/>
<path d="M656 330 C670 332 678 340 678 350 L648 346 Z" fill="#fff6d6"/>
<path d="M142 338 L164 334 L164 352 L141 354 Z" fill="#c0392b"/>
${wheel(230)}${wheel(584)}`;
}

function dashboard() {
  return `<rect width="800" height="600" fill="#1d2228"/>
<path d="M0 330 C200 270 600 270 800 330 L800 600 L0 600 Z" fill="#2a3038"/>
<path d="M0 330 C200 270 600 270 800 330" fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="6"/>
<rect x="0" y="0" width="800" height="250" fill="#9fb3cc" fill-opacity="0.35"/>
<circle cx="300" cy="420" r="150" fill="none" stroke="#111" stroke-width="26"/><circle cx="300" cy="420" r="38" fill="#111"/>
<path d="M300 420 L170 380 M300 420 L430 380 M300 420 L300 560" stroke="#111" stroke-width="24"/>
<circle cx="560" cy="360" r="70" fill="#0d1014" stroke="#3a4048" stroke-width="4"/>
<path d="M560 360 L600 320" stroke="#ff6b4a" stroke-width="4" stroke-linecap="round"/>
<text x="560" y="404" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="14" fill="#cfe9df">084,210 km</text>`;
}

function papers(d: Device) {
  return `<g transform="rotate(-4 400 300)">
<rect x="190" y="110" width="420" height="380" rx="8" fill="#000" fill-opacity="0.10" transform="translate(8 10)"/>
<rect x="190" y="110" width="420" height="380" rx="8" fill="#fbfaf4" stroke="#000" stroke-opacity="0.1"/>
<text x="400" y="160" text-anchor="middle" ${FONT} font-size="18" font-weight="700" fill="#17201d">Vehicle papers</text>
<text x="220" y="210" ${FONT} font-size="14" fill="#56625e">Owner</text><rect x="320" y="196" width="230" height="20" rx="4" fill="#17201d"/>
<text x="220" y="250" ${FONT} font-size="14" fill="#56625e">Make</text><text x="320" y="250" ${FONT} font-size="15" fill="#17201d">Toyota Corolla</text>
<text x="220" y="290" ${FONT} font-size="14" fill="#56625e">Year</text><text x="320" y="290" ${FONT} font-size="15" fill="#17201d">2014</text>
<text x="220" y="330" ${FONT} font-size="14" fill="#56625e">Chassis</text><text x="320" y="330" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="15" fill="#17201d">${d.masked}</text>
<circle cx="520" cy="420" r="42" fill="none" stroke="#1b6f6a" stroke-opacity="0.5" stroke-width="3"/><circle cx="520" cy="420" r="30" fill="none" stroke="#1b6f6a" stroke-opacity="0.35" stroke-width="2"/>
<text x="220" y="440" ${FONT} font-size="13" fill="#56625e">Name covered for privacy</text>
</g>`;
}

function sofa(d: Device) {
  let back = "", seat = "";
  for (let k = 0; k < 3; k++) {
    back += `<rect x="${208 + k * 130}" y="226" width="124" height="100" rx="22" fill="${d.finish[0]}" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>`;
    seat += `<rect x="${214 + k * 126}" y="322" width="120" height="42" rx="14" fill="${d.finish[0]}" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>`;
  }
  return `<ellipse cx="400" cy="444" rx="280" ry="16" fill="url(#floor)"/>
<rect x="190" y="214" width="420" height="130" rx="28" fill="url(#fin)"/>${back}
<rect x="200" y="340" width="400" height="74" rx="16" fill="${d.finish[1]}"/>${seat}
<rect x="148" y="268" width="74" height="150" rx="32" fill="url(#fin)"/><rect x="578" y="268" width="74" height="150" rx="32" fill="url(#fin)"/>
<path d="M190 414 L198 440 L212 440 L214 414 Z M586 414 L588 440 L602 440 L610 414 Z" fill="#5b4636"/>`;
}

function weave(d: Device) {
  let lines = "";
  for (let y = 0; y < 600; y += 10) lines += `<path d="M0 ${y} L800 ${y + 6}" stroke="#000" stroke-opacity="${y % 20 ? 0.06 : 0.1}" stroke-width="4"/>`;
  for (let x = 0; x < 800; x += 12) lines += `<path d="M${x} 0 L${x + 4} 600" stroke="#fff" stroke-opacity="0.08" stroke-width="3"/>`;
  return `<rect width="800" height="600" fill="${d.finish[0]}"/>${lines}<path d="M0 320 C240 260 520 380 800 300 L800 340 C520 420 240 300 0 360 Z" fill="#000" fill-opacity="0.12"/>`;
}

function sofaSize(d: Device) {
  return `${zoom(sofa(d), 400, 330, 0.86)}
<path d="M164 174 L636 174 M164 164 L164 184 M636 164 L636 184" stroke="#17201d" stroke-width="2"/>
<rect x="356" y="160" width="88" height="28" rx="14" fill="#fff"/><text x="400" y="179" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="#17201d">210 cm</text>
<path d="M680 220 L680 420 M670 220 L690 220 M670 420 L690 420" stroke="#17201d" stroke-width="2"/>
<rect x="644" y="306" width="72" height="28" rx="14" fill="#fff"/><text x="680" y="325" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="#17201d">85 cm</text>`;
}

function consoleTower(d: Device) {
  return `<ellipse cx="360" cy="446" rx="110" ry="12" fill="url(#floor)"/>
<rect x="338" y="146" width="44" height="290" rx="10" fill="#1d2126"/>
<path d="M360 160 L360 420" stroke="${d.screen[0]}" stroke-opacity="0.7" stroke-width="2"/>
<path d="M298 160 C318 146 336 146 340 152 L340 434 C320 438 304 434 298 426 C292 332 292 250 298 160 Z" fill="url(#fin)" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
<path d="M422 160 C402 146 384 146 380 152 L380 434 C400 438 416 434 422 426 C428 332 428 250 422 160 Z" fill="url(#fin)" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
<rect x="320" y="430" width="80" height="12" rx="6" fill="#1d2126"/>`;
}

function pad(x: number, y: number, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(-560 -380)">
<path d="M500 350 C520 334 600 334 620 350 C640 366 648 412 632 426 C618 438 600 424 590 406 L530 406 C520 424 502 438 488 426 C472 412 480 366 500 350 Z" fill="#f6f6f4" stroke="#000" stroke-opacity="0.12" stroke-width="2"/>
<path d="M532 350 L588 350 L582 390 L538 390 Z" fill="#1d2126"/>
<circle cx="540" cy="394" r="9" fill="#2a2f35"/><circle cx="580" cy="394" r="9" fill="#2a2f35"/>
<path d="M510 366 h14 M517 359 v14" stroke="#2a2f35" stroke-width="4" stroke-linecap="round"/>
<circle cx="604" cy="360" r="3.5" fill="#2a2f35"/><circle cx="612" cy="368" r="3.5" fill="#2a2f35"/><circle cx="596" cy="368" r="3.5" fill="#2a2f35"/><circle cx="604" cy="376" r="3.5" fill="#2a2f35"/>
</g>`;
}

function consoleFront(d: Device) { return consoleTower(d) + `<ellipse cx="560" cy="440" rx="90" ry="10" fill="url(#floor)"/>` + pad(560, 384); }

function consoleBack(d: Device) {
  let ports = "";
  for (let k = 0; k < 4; k++) ports += `<rect x="350" y="${300 + k * 22}" width="20" height="12" rx="2" fill="#0b0d10" stroke="#3a4048"/>`;
  return consoleTower(d) + ports + `<circle cx="360" cy="200" r="6" fill="none" stroke="#3a4048" stroke-width="2"/>`;
}

function consoleOn(d: Device) {
  return `<rect x="150" y="96" width="500" height="290" rx="12" fill="#0b0d10"/><rect x="160" y="106" width="480" height="270" rx="6" fill="url(#scr)"/>
<text x="400" y="252" text-anchor="middle" ${FONT} font-size="26" font-weight="600" fill="#fff" fill-opacity="0.9">Press the button to start</text>
<rect x="380" y="386" width="40" height="24" fill="#1d2126"/>
${zoom(consoleTower(d), 360, 300, 0.55).replace('translate(400 300)', 'translate(620 420)')}${pad(250, 470, 0.7)}`;
}

function pads(d: Device) {
  return `<ellipse cx="400" cy="450" rx="250" ry="16" fill="url(#floor)"/>${pad(300, 340, 1.1)}${pad(500, 380, 1.1)}
<g fill="none" stroke="#2a2f35" stroke-width="7" stroke-linecap="round"><ellipse cx="630" cy="250" rx="60" ry="24"/><ellipse cx="630" cy="242" rx="52" ry="20"/><path d="M576 254 C540 290 520 300 500 336"/></g>`;
}

// A wig on a mannequin head: long bone-straight hair falling past the shoulders.
function wig(d: Device) {
  return `<ellipse cx="400" cy="524" rx="150" ry="14" fill="url(#floor)"/>
<path d="M340 470 L460 470 L476 520 L324 520 Z" fill="#e8e4df"/>
<path d="M372 380 C372 430 360 450 340 470 L460 470 C440 450 428 430 428 380 Z" fill="${d.screen[0]}"/>
<path d="M300 210 C300 140 350 104 400 104 C450 104 500 140 500 210 L512 470 C470 490 440 470 432 430 L428 300 L372 300 L368 430 C360 470 330 490 288 470 Z" fill="url(#fin)"/>
<ellipse cx="400" cy="250" rx="62" ry="82" fill="${d.screen[0]}"/>
<path d="M338 236 C340 170 370 150 400 150 C430 150 460 170 462 236 C452 200 430 186 400 186 C370 186 348 200 338 236 Z" fill="url(#fin)"/>
<path d="M330 170 C326 260 322 380 312 470 M470 170 C474 260 478 380 488 470 M350 150 C344 250 342 380 336 476 M450 150 C456 250 458 380 464 476" stroke="#fff" stroke-opacity="0.10" stroke-width="3" fill="none"/>
<path d="M318 180 C312 280 306 380 298 460" stroke="#fff" stroke-opacity="0.22" stroke-width="6" fill="none" stroke-linecap="round"/>`;
}

function lace(d: Device) {
  let mesh = "";
  for (let x = 200; x <= 600; x += 14) mesh += `<path d="M${x} 150 L${x + 40} 450" stroke="#c9a88e" stroke-opacity="0.5" stroke-width="1"/>`;
  for (let y = 150; y <= 450; y += 14) mesh += `<path d="M200 ${y} L600 ${y + 10}" stroke="#c9a88e" stroke-opacity="0.5" stroke-width="1"/>`;
  return `<rect x="180" y="130" width="440" height="340" rx="30" fill="${d.screen[1]}"/>${mesh}
<path d="M180 330 C300 300 500 360 620 320 L620 470 L180 470 Z" fill="url(#fin)"/>
<rect x="250" y="420" width="300" height="34" rx="17" fill="#fff" fill-opacity="0.85"/><text x="400" y="443" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="#17201d">13 × 4 HD lace · medium cap</text>`;
}

function hairLength(d: Device) {
  let ticks = "";
  for (let i = 0; i <= 22; i += 2) ticks += `<path d="M560 ${110 + i * 17} h${i % 4 === 0 ? 18 : 10}" stroke="#17201d" stroke-width="2"/>${i % 4 === 0 ? `<text x="586" y="${115 + i * 17}" ${FONT} font-size="13" fill="#17201d">${i}"</text>` : ""}`;
  return `<path d="M380 100 C330 100 300 130 300 170 C296 300 290 400 280 480 C320 492 360 490 380 470 Z M420 100 C470 100 500 130 500 170 C504 300 510 400 520 480 C480 492 440 490 420 470 Z" fill="url(#fin)"/>
<rect x="548" y="100" width="6" height="384" rx="3" fill="#17201d" fill-opacity="0.7"/>${ticks}`;
}

function perfume(d: Device, back = false) {
  return `<ellipse cx="400" cy="486" rx="130" ry="14" fill="url(#floor)"/>
<rect x="370" y="140" width="60" height="50" rx="8" fill="#1d2126"/><rect x="380" y="186" width="40" height="22" fill="#8a9096"/>
<rect x="300" y="200" width="200" height="280" rx="26" fill="url(#fin)" fill-opacity="0.92"/>
<rect x="312" y="214" width="176" height="252" rx="18" fill="#fff" fill-opacity="0.08"/>
<path d="M318 220 L350 220 L330 460 L318 460 Z" fill="#fff" fill-opacity="0.22"/>
${back ? `<rect x="340" y="380" width="120" height="50" rx="6" fill="#fff" fill-opacity="0.85"/><path d="M352 394 h96 M352 406 h70 M352 418 h84" stroke="#17201d" stroke-opacity="0.5" stroke-width="3"/>`
  : `<rect x="340" y="300" width="120" height="60" rx="4" fill="#fff" fill-opacity="0.9"/><text x="400" y="336" text-anchor="middle" ${FONT} font-size="15" font-weight="700" letter-spacing="3" fill="#1d2d44">EAU DE</text><text x="400" y="352" text-anchor="middle" ${FONT} font-size="10" letter-spacing="2" fill="#1d2d44">PARFUM 100 ML</text>`}`;
}

function perfumeBox(d: Device) {
  return `<ellipse cx="400" cy="480" rx="170" ry="16" fill="url(#floor)"/>
<path d="M290 170 L400 140 L510 170 L400 200 Z" fill="${d.screen[0]}"/>
<path d="M290 170 L400 200 L400 470 L290 440 Z" fill="${d.screen[1]}"/>
<path d="M400 200 L510 170 L510 440 L400 470 Z" fill="${d.screen[2]}"/>
<text x="455" y="330" text-anchor="middle" ${FONT} font-size="16" font-weight="700" letter-spacing="3" fill="#fff" transform="rotate(-15 455 330)">PARFUM</text>
<path d="M290 170 L400 200 L510 170" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/>`;
}

export function seedArt(key: string): string {
  const [, listing, shot] = key.split("/");
  const n = Number(listing) || 1;
  const i = Number(shot) || 1;
  const d = DEVICES[((n - 1) % 13) + 1];
  const label = SHOTS[d.kind][(i - 1) % 5];
  let body: string;
  switch (d.kind) {
    case "phone": body = i === 1 ? phoneFront(d, lockScreen) : i === 2 ? phoneBack(d) : i === 3 ? phoneFront(d, homeScreen(), -8) : i === 4 ? phoneFront(d, imeiScreen(d)) : boxAndCable(d); break;
    case "laptop": body = i === 1 ? laptopFront(d, "") : i === 2 ? laptopLid(d) : i === 3 ? laptopFront(d, desktop, 1.12) : i === 4 ? serialLabel(d) : charger(d); break;
    case "shoe": body = i === 1 ? sneaker(d) : i === 2 ? mirror(sneaker(d)) : i === 3 ? zoom(sneaker(d), 470, 330, 2.1) : i === 4 ? tagCard("Size", "UK 9", ["EU 43 · US 10", "Made in Vietnam"]) : shoeBox(d); break;
    case "dress": body = i === 1 ? dress() : i === 2 ? dress(true) : i === 3 ? fabric() : i === 4 ? tagCard("Size", "12", ["UK 12 · EU 40", "100% cotton wax print", "Hand wash"]) : dress(false, false); break;
    case "car": body = i === 1 ? car(d) : i === 2 ? mirror(car(d)) : i === 3 ? dashboard() : i === 4 ? papers(d) : zoom(car(d), 584, 396, 2.6); break;
    case "sofa": body = i === 1 ? sofa(d) : i === 2 ? `<g transform="translate(400 330) skewY(-5) scale(0.86 1) translate(-400 -330)">${sofa(d)}</g>` : i === 3 ? weave(d) : i === 4 ? tagCard("Care label", "Dry clean", ["Polyester fabric", "Hardwood frame", "Keep out of direct sun"]) : sofaSize(d); break;
    case "wig": body = i === 1 ? wig(d) : i === 2 ? `<g transform="translate(400 300) scale(0.9 1) translate(-400 -300)">${mirror(wig(d))}</g>` : i === 3 ? zoom(wig(d), 312, 390, 2.6) : i === 4 ? lace(d) : hairLength(d); break;
    case "perfume": body = i === 1 ? perfume(d) : i === 2 ? perfume(d, true) : i === 3 ? perfumeBox(d) : i === 4 ? tagCard("Batch code", "4D21A", ["Printed under the box", "Matches the bottle"]) : zoom(perfume(d), 400, 170, 2.2); break;
    default: body = i === 1 ? consoleFront(d) : i === 2 ? consoleBack(d) : i === 3 ? consoleOn(d) : i === 4 ? serialLabel(d) : pads(d);
  }
  return frame(d, n, i, label, body);
}
