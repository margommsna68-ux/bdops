import { describe, it, expect, vi, beforeEach } from "vitest";

// Set a valid 32-byte hex key before importing
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryption", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
  });

  it("encrypts and decrypts text correctly", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const original = "hello world secret";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.split(":")).toHaveLength(3);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for same plaintext (random IV)", async () => {
    const { encrypt } = await import("@/lib/encryption");
    const a = encrypt("same text");
    const b = encrypt("same text");
    expect(a).not.toBe(b);
  });

  it("throws on invalid encrypted format", async () => {
    const { decrypt } = await import("@/lib/encryption");
    expect(() => decrypt("not-valid-format")).toThrow();
  });

  it("throws on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const encrypted = encrypt("secret data");
    const parts = encrypted.split(":");
    parts[2] = "AAAA" + parts[2].slice(4); // tamper with encrypted data
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws if ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    // Need fresh import to pick up env change
    vi.resetModules();
    const { encrypt } = await import("@/lib/encryption");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
  });

  it("throws if ENCRYPTION_KEY is wrong length", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "abcd1234"); // only 4 bytes
    vi.resetModules();
    const { encrypt } = await import("@/lib/encryption");
    expect(() => encrypt("test")).toThrow("32 bytes");
  });
});
