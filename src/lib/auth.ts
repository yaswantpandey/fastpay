import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  TotpSecret,
  MultiFactorResolver,
  MultiFactorError,
  User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";

export type SignInResult =
  | { status: "ok" }
  | { status: "mfa_required"; resolver: MultiFactorResolver };

export async function signInWithGoogle(): Promise<SignInResult> {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    await httpsCallable(functions, "bootstrapUser")();
    return { status: "ok" };
  } catch (err) {
    const e = err as MultiFactorError;
    if (e.code === "auth/multi-factor-auth-required") {
      return { status: "mfa_required", resolver: getMultiFactorResolver(auth, e) };
    }
    throw err;
  }
}

export async function resolveTotpSignIn(resolver: MultiFactorResolver, code: string) {
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error("No TOTP factor enrolled");
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
  await resolver.resolveSignIn(assertion);
  await httpsCallable(functions, "bootstrapUser")();
}

export async function startTotpEnrollment(user: User) {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const qrUrl = secret.generateQrCodeUrl(user.email ?? "user", "FastPay");
  return { secret, qrUrl };
}

export async function finishTotpEnrollment(user: User, secret: TotpSecret, code: string) {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  await multiFactor(user).enroll(assertion, "Authenticator app");
  // Force fresh token so the MFA claim is present for callable functions.
  await user.getIdToken(true);
  await httpsCallable(functions, "bootstrapUser")();
}

export function hasTotp(user: User): boolean {
  return multiFactor(user).enrolledFactors.some(
    (f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID
  );
}

export const signOut = () => fbSignOut(auth);
