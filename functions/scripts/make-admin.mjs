// Grant or revoke the admin custom claim.
//   Emulator:   node functions/scripts/make-admin.mjs you@example.com
//   Production: GOOGLE_APPLICATION_CREDENTIALS=key.json node functions/scripts/make-admin.mjs you@example.com --prod
//   Revoke:     add --revoke
// The user must sign out and back in (or refresh their token) for the change to apply.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
if (!email) { console.error("Usage: make-admin.mjs <email> [--revoke] [--prod]"); process.exit(1); }
if (!args.includes("--prod")) process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

initializeApp(args.includes("--prod") ? undefined : { projectId: "demo-fastpay" });
const user = await getAuth().getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}) };
if (args.includes("--revoke")) delete claims.admin; else claims.admin = true;
await getAuth().setCustomUserClaims(user.uid, claims);
console.log(`${args.includes("--revoke") ? "Revoked" : "Granted"} admin for ${email} (${user.uid})`);
