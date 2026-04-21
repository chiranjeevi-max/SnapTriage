/**
 * Mock data for User and Token repositories.
 * Used exclusively for testing.
 */

export const mockUser = {
  id: "USR-001",
  name: "Grace Hopper",
  email: "grace@example.com",
  image: "https://example.com/avatar.png",
};

export const mockTokenPayload = {
  userId: "USR-001",
  provider: "github",
  token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
  label: "Test GitHub Token",
};
