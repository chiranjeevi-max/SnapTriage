import { describe, it, expect, vi, beforeEach } from "vitest";
import { storeAccessToken, findUserByEmail } from "@/features/auth/user-repository";
import { typedDb } from "@/lib/db/query";
import { encrypt } from "@/lib/crypto";
import { mockUser, mockTokenPayload } from "../../../../tests/testData/users";

// RCS-001: Mock external dependencies directly attached to external functions
vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn(),
}));

vi.mock("@/lib/db/query", () => {
  const insertMock = vi.fn().mockReturnValue({ values: vi.fn() });
  const deleteMock = vi.fn().mockReturnValue({ where: vi.fn() });
  const selectMock = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn() }) });
  
  return {
    typedDb: {
      insert: insertMock,
      delete: deleteMock,
      select: selectMock,
    },
  };
});

describe("UserRepository", () => {
  
  beforeEach(() => {
    // RCS-001: Clear all overrides before each block runs
    vi.clearAllMocks();
  });

  describe("storeAccessToken", () => {
    /**
     * @target storeAccessToken
     * @dependencies db queries, crypto encryption
     * @scenario Replacing an existing token for a specific user and github provider
     * @expectedOutput Calls database delete and inserts the symmetrically encrypted AES token
     */
    it("should delete existing tokens and insert an encrypted payload", async () => {
      // 1. Arrange
      const encryptedMangledText = "aes256:gcm:dummy=dummy";
      vi.mocked(encrypt).mockReturnValue(encryptedMangledText);

      const deleteWhereSpy = vi.fn().mockResolvedValue(undefined);
      vi.mocked(typedDb.delete).mockReturnValue({ where: deleteWhereSpy } as any);

      const insertValuesSpy = vi.fn().mockResolvedValue(undefined);
      vi.mocked(typedDb.insert).mockReturnValue({ values: insertValuesSpy } as any);

      // 2. Act
      await storeAccessToken(mockTokenPayload);

      // 3. Assert - RCS-001 Verification typing
      expect(encrypt).toHaveBeenCalledWith(mockTokenPayload.token);
      expect(typedDb.delete).toHaveBeenCalled();
      expect(deleteWhereSpy).toHaveBeenCalled();
      expect(typedDb.insert).toHaveBeenCalled();
      expect(insertValuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockTokenPayload.userId,
          provider: mockTokenPayload.provider,
          token: encryptedMangledText, // Output string verification
        })
      );
    });
  });

  describe("findUserByEmail", () => {
    /**
     * @target findUserByEmail
     * @dependencies db selections
     * @scenario A valid user has matching entries inside the SQLite db
     * @expectedOutput Returning the extracted element correctly.
     */
    it("should successfully return a localized user payload", async () => {
      // 1. Arrange
      const expectedOutput = mockUser;
      const selectWhereSpy = vi.fn().mockResolvedValue([expectedOutput]);
      const selectFromSpy = vi.fn().mockReturnValue({ where: selectWhereSpy });
      vi.mocked(typedDb.select).mockReturnValue({ from: selectFromSpy } as any);

      // 2. Act
      const result = await findUserByEmail("grace@example.com");

      // 3. Assert
      expect(typedDb.select).toHaveBeenCalled();
      expect(result).toEqual(expectedOutput);
    });
  });
});
