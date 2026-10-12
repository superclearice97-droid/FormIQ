/* FormIQ coach customization: hairstyles, colours and outfit options for the animated coach.
   All artwork is original. Hair shapes are drawn in head coordinates (head radius 21, centre 0,0, up is negative y). */

/* hair shapes behind the head: ["e", cx, cy, rx, ry] ellipses or ["p", pathData]; tails: [ox, oy, dx, dy, width] strands that swing */
const sq = (x, y, r) => ["e", x, y, r, r];
export const CAPS = {   // the hairline / fringe drawn over the forehead
  buzz: "M-20 -4 Q-21 -20 0 -21 Q21 -20 20 -4 Q15 -12 0 -14 Q-15 -12 -20 -4Z",
  crop: "M-20.5 -3 Q-22 -21 0 -22 Q22 -21 20.5 -3 Q19 -9 12 -12 Q0 -15 -12 -12 Q-19 -9 -20.5 -3Z",
  wave: "M-20.5 -3 Q-22 -21 0 -22 Q22 -21 20.5 -3 Q17 -10 12 -9 Q8 -14 4 -10 Q0 -15 -4 -10 Q-8 -14 -12 -9 Q-17 -10 -20.5 -3Z",
  spiky: "M-21 -3 Q-20 -20 0 -21 Q20 -20 21 -3 Q16 -12 11 -9 Q9 -15 3 -10 Q-2 -17 -6 -9 Q-12 -13 -15 -5 Q-18 -7 -21 -3Z",
  sweep: "M-21 -2 Q-22 -22 0 -22 Q22 -22 21 -3 Q14 -6 6 -12 Q-4 -9 -10 -4 Q-15 -6 -21 -2Z",
  curtain: "M-21 0 Q-22 -22 0 -22 Q22 -22 21 0 Q16 -4 10 -14 Q4 -9 0 -18 Q-4 -9 -10 -14 Q-16 -4 -21 0Z",
  blunt: "M-21 -1 Q-22 -22 0 -22 Q22 -22 21 -1 L21 -7 Q10 -6 0 -7 Q-10 -6 -21 -7Z",
};

export const HAIR_STYLES = [
  { id: "buzz", name: "Buzz cut", cap: "buzz", vol: [] },
  { id: "crop", name: "Short crop", cap: "crop", vol: [["e", 0, -6, 21, 17]] },
  { id: "hightop", name: "High-top fade", cap: "crop", vol: [["e", 0, -17, 17, 13], ["e", 0, -6, 20, 14]] },
  { id: "waves", name: "Short waves", cap: "wave", vol: [["e", 0, -8, 22, 18]] },
  { id: "curly", name: "Curly top", cap: "wave", vol: [["e", -10, -17, 9, 8], ["e", 0, -21, 10, 9], ["e", 10, -17, 9, 8], ["e", -17, -9, 7, 7], ["e", 17, -9, 7, 7], ["e", 0, -8, 19, 14]] },
  { id: "afro", name: "Afro", cap: "crop", vol: [["e", 0, -5, 30, 29]] },
  { id: "twa", name: "Tapered afro", cap: "crop", vol: [["e", 0, -6, 24, 23]] },
  { id: "puffs", name: "Afro puffs", cap: "curtain", vol: [["e", -17, -19, 10, 10], ["e", 17, -19, 10, 10], ["e", 0, -4, 21, 19]] },
  { id: "knots", name: "Bantu knots", cap: "crop", vol: [["e", 0, -8, 21, 16], sq(-18, -14, 5.5), sq(-12, -21, 5.5), sq(-4, -24, 5.5), sq(4, -24, 5.5), sq(12, -21, 5.5), sq(18, -14, 5.5)] },
  { id: "cornrows", name: "Cornrows", cap: "crop", vol: [["e", 0, -7, 21, 17]], lines: true },
  { id: "braids", name: "Box braids", cap: "curtain", vol: [["e", 0, -6, 22, 20]], tails: [[-18, -4, -3, 38, 4], [-12, -8, -2, 40, 4], [-6, -10, -1, 36, 4], [6, -10, 1, 36, 4], [12, -8, 2, 40, 4], [18, -4, 3, 38, 4]] },
  { id: "locs", name: "Locs", cap: "wave", vol: [["e", 0, -6, 23, 21]], tails: [[-19, -2, -5, 34, 6], [-13, -7, -3, 40, 6], [-6, -10, -1, 32, 6], [6, -10, 1, 32, 6], [13, -7, 3, 40, 6], [19, -2, 5, 34, 6]] },
  { id: "braidpony", name: "Braided ponytail", cap: "sweep", vol: [["e", 0, -7, 21, 18]], tails: [[-8, -19, -10, 36, 5]] },
  { id: "ponytail", name: "High ponytail", cap: "sweep", vol: [["e", 0, -7, 21, 18]], tails: [[-6, -19, -12, 30, 10]] },
  { id: "twintails", name: "Twin tails", cap: "curtain", vol: [["e", 0, -7, 21, 18]], tails: [[-19, -6, -9, 30, 10], [19, -6, 9, 30, 10]] },
  { id: "spacebuns", name: "Space buns", cap: "curtain", vol: [["e", 0, -7, 21, 18], sq(-14, -23, 8), sq(14, -23, 8)] },
  { id: "topknot", name: "Top knot", cap: "sweep", vol: [["e", 0, -7, 21, 18], sq(0, -27, 8)] },
  { id: "manbun", name: "Low bun", cap: "crop", vol: [["e", 0, -7, 21, 17], sq(-14, -20, 8)] },
  { id: "long", name: "Long straight", cap: "curtain", vol: [["e", 0, -6, 23, 22]], tails: [[-20, -2, -4, 40, 14], [20, -2, 4, 40, 14]] },
  { id: "bob", name: "Bob", cap: "blunt", vol: [["e", 0, -4, 24, 22]], tails: [[-21, -2, -2, 16, 13], [21, -2, 2, 16, 13]] },
  { id: "pixie", name: "Pixie", cap: "sweep", vol: [["e", 0, -8, 22, 18]] },
  { id: "mohawk", name: "Mohawk", cap: "buzz", vol: [["e", 0, -27, 5.5, 13], ["e", 0, -9, 13, 11]] },
  { id: "spiky", name: "Spiky", cap: "spiky", vol: [["p", "M-20 -8 L-24 -22 L-14 -16 L-12 -30 L-4 -20 L0 -34 L5 -20 L12 -30 L14 -16 L24 -22 L20 -8Z"], ["e", 0, -8, 21, 16]] },
  { id: "undercut", name: "Slick undercut", cap: "crop", vol: [["e", 2, -12, 21, 13]] },
  { id: "bald", name: "Bald", cap: null, vol: [] },
];
const C = (name, hex) => ({ name, hex });
export const HAIR_COLORS = [C("Jet black", "#17151c"), C("Soft black", "#2a2530"), C("Blue black", "#1b2038"), C("Dark brown", "#3a2418"), C("Brown", "#6a4126"), C("Chestnut", "#8a4a2a"), C("Auburn", "#8f3b2e"), C("Blonde", "#e8c97a"), C("Silver", "#b9bec9"), C("White", "#f2f2f5"), C("Blue", "#4a6cff"), C("Pink", "#ff8fb3"), C("Purple", "#8a5cff"), C("Green", "#3fbf84")];
export const SKIN = [C("Light", "#ffe0cc"), C("Fair", "#f7cba8"), C("Tan", "#e7b08a"), C("Golden", "#c98c63"), C("Brown", "#a96b46"), C("Deep brown", "#8a5233"), C("Dark", "#6b3d25"), C("Deepest", "#4a2a1a")];
export const EYES = [C("Brown", "#5a3320"), C("Dark", "#2b2538"), C("Hazel", "#8a6a2a"), C("Green", "#2f8a5a"), C("Blue", "#3b5bdb"), C("Violet", "#6b46c1")];
export const TOP_COLORS = [C("White", "#ffffff"), C("Black", "#2a2b33"), C("Teal", "#1fb58a"), C("Blue", "#3b82f6"), C("Purple", "#8b5cf6"), C("Pink", "#f472b6"), C("Red", "#ef4444"), C("Yellow", "#fbbf24"), C("Grey", "#9ca3af"), C("Green", "#22a55b")];
export const BOTTOM_COLORS = [C("Black", "#24252d"), C("Charcoal", "#4b5563"), C("Navy", "#2f3f86"), C("Teal", "#0f766e"), C("Purple", "#6d28d9"), C("Maroon", "#9b2c4a"), C("Grey", "#9ca3af"), C("White", "#f3f4f6")];
export const SHOE_COLORS = [C("White", "#f5f5f7"), C("Black", "#2b2b33"), C("Coral", "#ff6b81"), C("Mint", "#4fd1a1"), C("Blue", "#4f7cff"), C("Yellow", "#ffd166"), C("Purple", "#9b6bff")];
export const ACCENT_COLORS = [C("Black", "#2d2d3a"), C("White", "#ffffff"), C("Teal", "#1fb58a"), C("Blue", "#3b82f6"), C("Pink", "#f472b6"), C("Red", "#ef4444"), C("Yellow", "#fbbf24"), C("Purple", "#8b5cf6")];

export const PROPORTIONS = {
  chibi: { name: "Chibi", head: 21, torso: 30, thigh: 24, shin: 24, up: 17, low: 16 },
  sporty: { name: "Sporty", head: 17.5, torso: 32, thigh: 27, shin: 27, up: 19, low: 18 },
  athletic: { name: "Athletic", head: 15, torso: 34, thigh: 30, shin: 30, up: 21, low: 20 },
};
export const BUILDS = {
  slim: { name: "Slim", limb: 6.2, leg: 7.4, torso: 16, sw: 9 },
  average: { name: "Average", limb: 7.2, leg: 8.4, torso: 18, sw: 10 },
  strong: { name: "Strong", limb: 8.6, leg: 9.8, torso: 21, sw: 12 },
};
export const TOPS = { tank: "Tank top", crop: "Crop top", tee: "T-shirt" };
export const BOTTOMS = { shorts: "Shorts", capris: "Capris", leggings: "Leggings" };

export const DEFAULT_LOOK = { hair: "waves", hairColor: 1, skin: 4, eyes: 0, build: "average", prop: "athletic", top: "tank", topColor: 2, bottom: "capris", bottomColor: 1, shoes: 0,
  band: false, bandColor: 2, wrist: false, wristColor: 2, gloves: false, glasses: false };

const KEY = "formiq.coach.look";
const pick = a => a[Math.floor(Math.random() * a.length)];
const idx = a => Math.floor(Math.random() * a.length);
export function randomLook() {
  return { hair: pick(HAIR_STYLES).id, hairColor: Math.random() < 0.6 ? idx(HAIR_COLORS.slice(0, 3)) : idx(HAIR_COLORS), skin: idx(SKIN), eyes: idx(EYES), build: pick(Object.keys(BUILDS)),
    prop: DEFAULT_LOOK.prop, top: pick(Object.keys(TOPS)), topColor: idx(TOP_COLORS), bottom: pick(Object.keys(BOTTOMS)), bottomColor: idx(BOTTOM_COLORS), shoes: idx(SHOE_COLORS),
    band: Math.random() < 0.4, bandColor: idx(ACCENT_COLORS), wrist: Math.random() < 0.4, wristColor: idx(ACCENT_COLORS), gloves: Math.random() < 0.2, glasses: Math.random() < 0.2 };
}
export function sanitizeLook(l) {
  const d = { ...DEFAULT_LOOK, ...(l && typeof l === "object" ? l : {}) };
  const n = (v, len, def) => Number.isInteger(v) && v >= 0 && v < len ? v : def;
  return { hair: HAIR_STYLES.some(h => h.id === d.hair) ? d.hair : DEFAULT_LOOK.hair, hairColor: n(d.hairColor, HAIR_COLORS.length, 1), skin: n(d.skin, SKIN.length, 4), eyes: n(d.eyes, EYES.length, 0),
    build: BUILDS[d.build] ? d.build : "average", prop: PROPORTIONS[d.prop] ? d.prop : "athletic", top: TOPS[d.top] ? d.top : "tank", topColor: n(d.topColor, TOP_COLORS.length, 2),
    bottom: BOTTOMS[d.bottom] ? d.bottom : "capris", bottomColor: n(d.bottomColor, BOTTOM_COLORS.length, 1), shoes: n(d.shoes, SHOE_COLORS.length, 0),
    band: !!d.band, bandColor: n(d.bandColor, ACCENT_COLORS.length, 2), wrist: !!d.wrist, wristColor: n(d.wristColor, ACCENT_COLORS.length, 2), gloves: !!d.gloves, glasses: !!d.glasses };
}
export function loadLook() { try { return sanitizeLook(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_LOOK }; } }
export function saveLook(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private window: keep for this visit only */ } }
