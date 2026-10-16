// Development data: Tunde's iPhone 13 from the Claude Design screens and ten more Lagos listings across the
// marketplace (phones, laptops, shoes, clothes, hair, perfume, a car, a sofa, a console), two sellers who pass the ID and
// bank checks, and a staff admin. Safe to run again: it only adds what is missing.
import pg from "pg";
import { webcrypto as crypto } from "node:crypto";
import { databaseUrl } from "./db-url.mjs";
import { devVars } from "./env.mjs";
import { createStaff } from "./create-staff.mjs";

const vars = devVars();
const enc = new TextEncoder();
const keyRaw = Uint8Array.from(atob(vars.FIELD_KEY), (c) => c.charCodeAt(0)).slice(0, 32);
const aes = await crypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["encrypt"]);
const hmacKey = await crypto.subtle.importKey("raw", enc.encode(vars.FIELD_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(text)));
  return Buffer.concat([iv, ct]);
}
const hmac = async (t) => Buffer.from(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(t)));

const db = new pg.Client({ connectionString: databaseUrl() });
await db.connect();
// The test admin's password is written right here, so it's created only in a database on this computer.
// Online databases get real staff accounts from `pnpm staff:create` instead.
const local = ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl()).hostname);
const staffPassword = "noshen-dev-staff";
let staffId = null;
if (local) {
  const existingStaff = await db.query("select id from staff where email = 'tobi@noshen.test'");
  staffId = existingStaff.rows[0]?.id ?? await createStaff(db, "Tobi Bello", "tobi@noshen.test", "admin", staffPassword);
}

// Seed sellers are verified (ID and bank), so like any verified seller they have no deal limit.

async function seller(fullName, email, last4) {
  const found = await db.query("select id from users where email = $1", [email]);
  if (found.rows[0]) {
    await db.query("update users set max_deal_kobo = null where id = $1 and max_deal_kobo is not null", [found.rows[0].id]);
    return found.rows[0].id;
  }
  const authId = crypto.randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())`, [authId, fullName, email]);
  const u = await db.query("insert into users (email, full_name, auth_user_id, signup_source) values ($1, $2, $3, 'seed') returning id",
    [email, fullName, authId]);
  const id = u.rows[0].id;
  await db.query(`insert into kyc_checks (user_id, type, provider, provider_ref, result, verified_name, checked_at) values ($1, 'nin', 'fake', $2, 'verified', $3, now())`,
    [id, `seed_${id}`, fullName]);
  const number = `01234${last4.padStart(5, "0")}`;
  await db.query(
    `insert into bank_accounts (user_id, bank_code, account_number_enc, account_number_hmac, account_last4, account_name, name_matches_id, is_default, verified_at)
     values ($1, '058', $2, $3, $4, $5, true, true, now())`, [id, await encrypt(number), await hmac(`acct:${number}`), number.slice(-4), fullName.toUpperCase()]);
  return id;
}

const tunde = await seller("Tunde Bakare", "tunde@example.com", "1234");
const kunle = await seller("Kunle Adeyemi", "kunle@example.com", "5521");

const LISTINGS = [
  [tunde, "phone", "iPhone 13, 128GB", 450000, "good", "Yaba|Lagos", "352918112047631", "Used for one year. Battery health 86%. No cracks. Comes with the box and cable.", 2, [2500, 6000]],
  [kunle, "laptop", "HP EliteBook 840 G5", 285000, "good", "Wuse 2|FCT", "5CG8274XQZ", "Core i5 8th gen, 8GB RAM, 256GB SSD. Battery good, holds about 3 hours. Charger included.", 26, [2500, 7000]],
  [tunde, "phone", "Samsung Galaxy S21, 128GB", 310000, "like_new", "GRA Phase 2|Rivers", "351234567890123", "Bought in March. Screen protector on since day one.", 3, [2000, 6000]],
  [kunle, "laptop", "MacBook Air M1, 256GB", 620000, "like_new", "Lekki|Lagos", "FVFG1234Q6L4", "8GB RAM. 91 battery cycles. Comes with the original charger.", 8, [0, 7000]],
  [kunle, "phone", "iPhone 11, 64GB", 235000, "fair", "Ikeja|Lagos", "356789012345670", "Works well. Small scratch on the back. Battery health 79%.", 30, [2500, 6000]],
  [tunde, "laptop", "Dell Latitude 7490", 240000, "good", "Bodija|Oyo", "7490DL22X", "Core i7, 16GB RAM, 512GB SSD. Keyboard like new.", 50, [3000, null]],
  [kunle, "shoes", "Nike Air Force 1, size 43", 45000, "like_new", "Lekki|Lagos", null, "Worn twice. UK 9 / EU 43. Original box included.", 4, [2000, 4500]],
  [tunde, "fashion", "Ankara maxi dress, size 12", 18000, "new", "Nassarawa GRA|Kano", null, "Sewn last month, never worn. Cotton wax print, side zip, fully lined.", 6, [1500, 3500]],
  [kunle, "vehicle", "Toyota Corolla 2014, automatic", 9800000, "good", "Garki|FCT", "2T1BURHE0EC123456", "Foreign used, cleared 2021. 84,000 km. AC works, new tyres. Papers complete.", 20, null],
  [tunde, "home", "3-seater fabric sofa, grey", 250000, "good", "Gbagada|Lagos", null, "Two years old, no tears. Hardwood frame. You arrange pickup.", 30, null],
  [kunle, "electronics", "PlayStation 5 with two pads", 650000, "like_new", "Victoria Island|Lagos", "E7K4QX2021", "Disc edition. Two pads, HDMI and power cables. No faults.", 9, [3000, 8000]],
  [tunde, "hair", "Bone straight wig, 22 inches", 185000, "like_new", "Independence Layout|Enugu", null, "100% human hair, 13x4 HD lace, medium cap. Worn twice, washed and restyled.", 3, [0, 5000]],
  [kunle, "beauty", "Eau de parfum, 100ml, sealed", 65000, "new", "Ugbowo|Edo", null, "Sealed in the box. Batch code matches the bottle. Bought in Dubai last month.", 5, [1500, 4000]],
];
let n = 0;
let added = 0;
// Demo listings are spread across Nigeria (area|state), so the marketplace reads as nationwide.
// The last column is delivery in naira: [within the state, to other states] (null: not offered, 0: free), or null for meet-up only.
for (const [sellerId, cat, title, naira, cond, place, imei, desc, hoursAgo, delivery] of LISTINGS) {
  n++;
  const [area, state] = place.split("|");
  const keys = [1, 2, 3, 4, 5].map((i) => `seed/${n}/${i}`);
  const [local, other] = (delivery ?? [null, null]).map((v) => (v === null ? null : v * 100));
  const have = await db.query("select 1 from listings where photo_keys[1] = $1", [keys[0]]);
  if (have.rows[0]) {
    // Keep earlier demo rows in step with the places and delivery prices above.
    await db.query(`update listings set area = $2, state = $3, delivery_local_kobo = $4, delivery_other_kobo = $5 where photo_keys[1] = $1
                      and (area, state, delivery_local_kobo, delivery_other_kobo) is distinct from ($2, $3, $4::bigint, $5::bigint)`, [keys[0], area, state, local, other]);
    continue;
  }
  added++;
  await db.query(
    `insert into listings (seller_id, category, title, description, price_kobo, condition, area, state, imei_or_serial, photo_keys, status, published_at, created_at,
                           delivery_local_kobo, delivery_other_kobo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live', now() - make_interval(hours => $11), now() - make_interval(hours => $11), $12, $13)`,
    [sellerId, cat, title, desc, naira * 100, cond, area, state, imei, keys, hoursAgo, local, other]);
}
await db.end();
console.log(`Seed: ${added} new listing(s), ${LISTINGS.length} in all. Sellers tunde@example.com and kunle@example.com.` +
  (local ? ` Staff admin tobi@noshen.test / ${staffPassword}` : " No staff account (online database): use pnpm staff:create."));
