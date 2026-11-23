// API Sikuzani : joueurs, scores et classement (Netlify Blobs).
import { getStore } from "@netlify/blobs";

const AVATARS = ["sage","reine","griot","guerrier","ecoliere","sapeur","maman","pecheur","rumbero","okapi","leopard","savante"];
const BOARD_SIZE = 100;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (msg, status = 400) => json({ error: msg }, status);

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rand = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => ALPHA[x % ALPHA.length]).join(""); };
const newCode = () => `SIKU-${rand(4)}-${rand(4)}`;
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SIKU/, "");
const codeKey = (c) => { const n = normCode(c); return n.length === 8 ? `SIKU-${n.slice(0,4)}-${n.slice(4)}` : null; };
const cleanName = (s) => String(s || "").replace(/[<>"'`&\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanContact = (s) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 80);

let itemsCache = null;
async function items(req) {
  if (itemsCache) return itemsCache;
  const r = await fetch(new URL("/items.json", req.url));
  if (!r.ok) throw new Error("items.json introuvable");
  itemsCache = await r.json();
  return itemsCache;
}
function cleanBest(best, known) {
  const out = {};
  for (const [id, sc] of Object.entries(best || {})) {
    const max = known[id];
    const n = Math.floor(Number(sc));
    if (max && Number.isFinite(n) && n >= 0) out[id] = Math.min(n, max);
  }
  return out;
}
const pointsOf = (best) => Object.values(best).reduce((a, b) => a + b, 0) * 10;
const publicOf = (p) => ({ id: p.id, name: p.name, av: p.av, pts: p.pts });
const meOf = (p) => ({ code: p.code, id: p.id, name: p.name, av: p.av, pts: p.pts, best: p.best });

async function updateBoard(board, p, remove = false) {
  let list = (await board.get("top", { type: "json" })) || [];
  list = list.filter(e => e.id !== p.id);
  if (!remove && p.pts > 0) list.push({ ...publicOf(p), t: Date.now() });
  list.sort((a, b) => b.pts - a.pts || a.t - b.t);
  await board.setJSON("top", list.slice(0, BOARD_SIZE));
}

export default async (req) => {
  const players = getStore({ name: "joueurs", consistency: "strong" });
  const contacts = getStore({ name: "contacts-concours", consistency: "strong" });
  const board = getStore({ name: "classement", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  try {
    if (req.method === "GET" && route === "board") {
      const list = (await board.get("top", { type: "json" })) || [];
      return json({ top: list.slice(0, 50).map(({ t, ...e }) => e) });
    }
    if (req.method !== "POST") return fail("Méthode non autorisée", 405);
    const raw = await req.text();
    if (raw.length > 5000) return fail("Requête trop grande", 413);
    let body; try { body = JSON.parse(raw || "{}"); } catch { return fail("JSON invalide"); }

    if (route === "register") {
      const av = AVATARS.includes(body.av) ? body.av : null;
      if (!av) return fail("Personnage inconnu");
      if (body.consent !== true) return fail("Consentement requis");
      const known = await items(req);
      let code; do { code = newCode(); } while (await players.get(code));
      const best = cleanBest(body.best, known);
      const p = { code, id: rand(10), name: cleanName(body.name), av, best, pts: pointsOf(best), created: new Date().toISOString() };
      await players.setJSON(code, p);
      const contact = cleanContact(body.contact);
      if (contact) await contacts.setJSON(p.id, { id: p.id, name: p.name, contact, created: p.created });
      await updateBoard(board, p);
      return json(meOf(p));
    }

    const code = codeKey(body.code);
    if (!code) return fail("Code joueur invalide");
    const p = await players.get(code, { type: "json" });
    if (!p) return fail("Code joueur inconnu", 404);

    if (route === "sync") return json(meOf(p));

    if (route === "score") {
      const known = await items(req);
      const id = String(body.item || "");
      if (!known[id]) return fail("Cours ou quiz inconnu");
      const sc = Math.min(Math.max(Math.floor(Number(body.score) || 0), 0), known[id]);
      if (sc > (p.best[id] || 0)) {
        p.best[id] = sc; p.pts = pointsOf(p.best); p.updated = new Date().toISOString();
        await players.setJSON(code, p);
        await updateBoard(board, p);
      }
      return json(meOf(p));
    }

    if (route === "profile") {
      if (body.av && AVATARS.includes(body.av)) p.av = body.av;
      if (typeof body.name === "string") p.name = cleanName(body.name);
      if (typeof body.contact === "string") {
        const contact = cleanContact(body.contact);
        if (contact) await contacts.setJSON(p.id, { id: p.id, name: p.name, contact, created: new Date().toISOString() });
        else await contacts.delete(p.id);
      }
      await players.setJSON(code, p);
      await updateBoard(board, p);
      return json(meOf(p));
    }

    if (route === "delete") {
      await players.delete(code);
      await contacts.delete(p.id);
      await updateBoard(board, p, true);
      return json({ deleted: true });
    }

    return fail("Route inconnue", 404);
  } catch (e) {
    return fail("Erreur serveur", 500);
  }
};

export const config = { path: "/api/*" };
