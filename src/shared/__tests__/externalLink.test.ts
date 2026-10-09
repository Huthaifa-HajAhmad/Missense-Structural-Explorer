import { describe, expect, it } from "vitest";
import { safeExternalHref } from "../externalLink";

describe("safeExternalHref", () => {
  it("passes absolute http(s) links, normalized", () => {
    expect(safeExternalHref("https://search.clinicalgenome.org/kb/gene-dosage/HGNC:9588")).toBe(
      "https://search.clinicalgenome.org/kb/gene-dosage/HGNC:9588"
    );
    expect(safeExternalHref("http://example.org/a/b")).toBe("http://example.org/a/b");
  });

  it("rejects executable and non-web schemes", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalHref("file:///C:/Users/etc")).toBeNull();
    expect(safeExternalHref("vbscript:msgbox")).toBeNull();
  });

  it("rejects malformed input rather than rendering it", () => {
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("not a url")).toBeNull();
  });
});
