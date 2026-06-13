import { describe, it, expect, beforeEach } from "vitest";
import {
  mintToken,
  isToken,
  extractLogicalId,
  resolveValue,
  resetTokens,
} from "../src/runtime/tokens";

describe("tokens", () => {
  beforeEach(() => {
    resetTokens();
  });

  describe("mintToken", () => {
    it("returns a string with token pattern", () => {
      const token = mintToken({ kind: "ref", logicalId: "MyBucket" });
      expect(token).toMatch(/\$\{Token\[t\d+\]\}/);
    });

    it("returns unique tokens", () => {
      const t1 = mintToken({ kind: "ref", logicalId: "A" });
      const t2 = mintToken({ kind: "ref", logicalId: "B" });
      expect(t1).not.toBe(t2);
    });
  });

  describe("isToken", () => {
    it("detects token strings", () => {
      const token = mintToken({ kind: "ref", logicalId: "X" });
      expect(isToken(token)).toBe(true);
    });

    it("detects tokens embedded in larger strings", () => {
      const token = mintToken({ kind: "ref", logicalId: "X" });
      expect(isToken(`prefix-${token}-suffix`)).toBe(true);
    });

    it("returns false for plain strings", () => {
      expect(isToken("hello")).toBe(false);
    });
  });

  describe("extractLogicalId", () => {
    it("extracts logical ID from a ref token", () => {
      const token = mintToken({ kind: "ref", logicalId: "MyBucket" });
      expect(extractLogicalId(token)).toBe("MyBucket");
    });

    it("extracts logical ID from a getAtt token", () => {
      const token = mintToken({ kind: "getAtt", logicalId: "MyRole", attribute: "Arn" });
      expect(extractLogicalId(token)).toBe("MyRole");
    });

    it("returns undefined for non-token strings", () => {
      expect(extractLogicalId("plain string")).toBeUndefined();
    });

    it("returns undefined for sub tokens (no logical ID)", () => {
      const token = mintToken({ kind: "sub", template: "hello-${AWS::Region}" });
      expect(extractLogicalId(token)).toBeUndefined();
    });
  });

  describe("resolveValue", () => {
    it("resolves a pure ref token to Ref intrinsic", () => {
      const token = mintToken({ kind: "ref", logicalId: "MyBucket" });
      expect(resolveValue(token)).toEqual({ Ref: "MyBucket" });
    });

    it("resolves a pure getAtt token", () => {
      const token = mintToken({ kind: "getAtt", logicalId: "MyRole", attribute: "Arn" });
      expect(resolveValue(token)).toEqual({ "Fn::GetAtt": ["MyRole", "Arn"] });
    });

    it("resolves a token embedded in a string to Fn::Join", () => {
      const token = mintToken({ kind: "getAtt", logicalId: "Bucket", attribute: "Arn" });
      const value = `${token}/*`;
      expect(resolveValue(value)).toEqual({
        "Fn::Join": ["", [{ "Fn::GetAtt": ["Bucket", "Arn"] }, "/*"]],
      });
    });

    it("resolves multiple tokens in a string", () => {
      const t1 = mintToken({ kind: "ref", logicalId: "A" });
      const t2 = mintToken({ kind: "ref", logicalId: "B" });
      const value = `${t1}:${t2}`;
      expect(resolveValue(value)).toEqual({
        "Fn::Join": ["", [{ Ref: "A" }, ":", { Ref: "B" }]],
      });
    });

    it("passes plain strings through unchanged", () => {
      expect(resolveValue("hello")).toBe("hello");
    });

    it("passes numbers through unchanged", () => {
      expect(resolveValue(42)).toBe(42);
    });

    it("passes booleans through unchanged", () => {
      expect(resolveValue(true)).toBe(true);
    });

    it("resolves tokens inside nested objects", () => {
      const token = mintToken({ kind: "ref", logicalId: "MyBucket" });
      const obj = { outer: { inner: token } };
      expect(resolveValue(obj)).toEqual({ outer: { inner: { Ref: "MyBucket" } } });
    });

    it("resolves tokens inside arrays", () => {
      const token = mintToken({ kind: "ref", logicalId: "X" });
      expect(resolveValue([token, "plain"])).toEqual([{ Ref: "X" }, "plain"]);
    });

    it("resolves a sub token", () => {
      const token = mintToken({ kind: "sub", template: "arn:aws:s3:::${BucketName}" });
      expect(resolveValue(token)).toEqual({ "Fn::Sub": "arn:aws:s3:::${BucketName}" });
    });

    it("handles null and undefined", () => {
      expect(resolveValue(null)).toBeNull();
      expect(resolveValue(undefined)).toBeUndefined();
    });
  });
});
