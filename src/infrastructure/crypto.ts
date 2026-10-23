import {
  randomBytes,
  pbkdf2,
  timingSafeEqual,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
const derive = promisify(pbkdf2);
export const newToken = () => randomBytes(48).toString("base64url");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex").toUpperCase();
export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    subkey = await derive(password, salt, 210000, 32, "sha512"),
    header = Buffer.alloc(13);
  header[0] = 1;
  header.writeUInt32BE(2, 1);
  header.writeUInt32BE(210000, 5);
  header.writeUInt32BE(16, 9);
  return Buffer.concat([header, salt, subkey]).toString("base64");
}
let dummy: Promise<string> | undefined;
export async function verifyPassword(
  hash: string | null,
  format: string | null,
  password: string,
): Promise<{ valid: boolean; rehash: boolean }> {
  if (!hash) {
    dummy ??= hashPassword(newToken());
    await verifyPassword(await dummy, "aspnet", password);
    return { valid: false, rehash: false };
  }
  try {
    if (format === "bcrypt") {
      const valid = await bcrypt.compare(password, hash);
      return { valid, rehash: valid };
    }
    if (format !== "aspnet") return { valid: false, rehash: false };
    const bytes = Buffer.from(hash, "base64");
    let salt: Buffer,
      subkey: Buffer,
      iterations: number,
      digest: string,
      rehash: boolean;
    if (bytes[0] === 0 && bytes.length === 49) {
      salt = bytes.subarray(1, 17);
      subkey = bytes.subarray(17);
      iterations = 1000;
      digest = "sha1";
      rehash = true;
    } else if (bytes[0] === 1 && bytes.length >= 29) {
      const prf = bytes.readUInt32BE(1),
        size = bytes.readUInt32BE(9);
      iterations = bytes.readUInt32BE(5);
      digest = ["sha1", "sha256", "sha512"][prf] ?? "";
      salt = bytes.subarray(13, 13 + size);
      subkey = bytes.subarray(13 + size);
      rehash = iterations < 210000 || prf !== 2;
      if (
        size < 16 ||
        subkey.length < 16 ||
        !digest ||
        iterations < 1 ||
        iterations > 10000000
      )
        return { valid: false, rehash: false };
    } else return { valid: false, rehash: false };
    const actual = await derive(
      password,
      salt,
      iterations,
      subkey.length,
      digest,
    );
    const valid = timingSafeEqual(actual, subkey);
    return { valid, rehash: valid && rehash };
  } catch {
    return { valid: false, rehash: false };
  }
}
export function encrypt(
  value: string,
  key: Buffer,
  purpose = "ConcursaAI/email-link/v1",
) {
  const derived = createHmac("sha256", key).update(purpose).digest(),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derived, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}
export function decrypt(
  value: string,
  key: Buffer,
  purpose = "ConcursaAI/email-link/v1",
) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 29) throw new Error("Conteúdo protegido inválido.");
  const derived = createHmac("sha256", key).update(purpose).digest(),
    decipher = createDecipheriv("aes-256-gcm", derived, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
